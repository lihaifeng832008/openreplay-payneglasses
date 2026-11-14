// add lee 2026.11.14 看屏录像边录边传（Lee 11-14 定：只经 OpenReplay 后台上传，不改 S3 跨域）
// 录像器每 200ms 交出一小段 → 攒够约 6MB 切成一段 → 按段号顺序一段一段交给后台（后台转存为 S3 分段）
// → 停止时传完最后一段并“完成”，S3 按段号拼成一个文件。
// 入口 nginx 单次请求上限 10MB，所以每段约 6MB；S3 要求除最后一段外每段至少 5MB。
// 失败的段原地重试（同段号覆盖，安全）；断网时先存内存，恢复后接着传。
// modify lee 2026.11.14 页面关闭 / 刷新（客户或坐席断开导致）时，发 keepalive“完成”，后台立即把已传分段合成为“已完成”；
// 连这个也没发出去时，后台定时任务 30 分钟后兜底（标 interrupted）。保存过程显示剩余段数。
// end
import { recordingsService } from 'App/services';

const PART_BYTES = 6 * 1024 * 1024;
const RETRY_DELAYS = [1000, 3000, 8000];
const RETRY_LATER_MS = 10000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default class PgRecordUploader {
  private recordId: number | null = null;
  private startPromise: Promise<void>;
  private pending: Blob[] = [];
  private pendingSize = 0;
  private queue: { n: number; blob: Blob }[] = [];
  private nextPart = 1;
  private pumping = false;
  private finished = false;
  private failed = false;
  private retryTimer: any = null;
  private startedAt = Date.now(); // add lee 2026.11.14 离开页面时估算时长
  private onLeave = () => this.leave(); // add lee 2026.11.14

  constructor(
    private siteId: string,
    sessionId: string,
    name: string,
  ) {
    this.startPromise = recordingsService
      .startUpload(siteId, { name, sessionId })
      .then((r) => {
        this.recordId = r.recordId;
      })
      .catch((e) => {
        this.failed = true;
        console.error('[pg-record] start upload failed', e);
      });
    // add lee 2026.11.14 页面关闭 / 刷新 / 跳走时主动“完成”
    window.addEventListener('pagehide', this.onLeave);
    // end
  }

  /** 还没传完的段数（含还没攒满的那部分） */
  remaining() {
    return this.queue.length + (this.pendingSize > 0 ? 1 : 0);
  }

  /** 录像器每交出一小段就调用 */
  push(chunk: Blob) {
    if (this.finished || !chunk || chunk.size === 0) return;
    this.pending.push(chunk);
    this.pendingSize += chunk.size;
    if (this.pendingSize >= PART_BYTES) {
      this.cut();
      void this.pump();
    }
  }

  private cut() {
    if (this.pendingSize === 0) return;
    this.queue.push({
      n: this.nextPart++,
      blob: new Blob(this.pending, { type: 'video/webm' }),
    });
    this.pending = [];
    this.pendingSize = 0;
  }

  /** 按段号顺序一段一段传；某段重试用尽就停下，稍后再试（不跳段，保证顺序） */
  private async pump(onProgress?: (left: number) => void): Promise<boolean> {
    if (this.pumping) return false;
    this.pumping = true;
    try {
      await this.startPromise;
      if (this.recordId === null) return false;
      while (this.queue.length) {
        onProgress?.(this.queue.length);
        const part = this.queue[0];
        let ok = false;
        for (let i = 0; i <= RETRY_DELAYS.length && !ok; i++) {
          try {
            await recordingsService.uploadPart(
              this.siteId,
              this.recordId,
              part.n,
              part.blob,
            );
            ok = true;
          } catch (e) {
            console.warn(`[pg-record] part ${part.n} failed (try ${i + 1})`, e);
            if (i < RETRY_DELAYS.length) await sleep(RETRY_DELAYS[i]);
          }
        }
        if (!ok) {
          if (!this.finished && !this.retryTimer) {
            this.retryTimer = setTimeout(() => {
              this.retryTimer = null;
              void this.pump();
            }, RETRY_LATER_MS);
          }
          return false;
        }
        this.queue.shift();
      }
      return true;
    } finally {
      this.pumping = false;
    }
  }

  // add lee 2026.11.14 页面要离开：大分段发不出去了，只发一个很小的“完成”，后台把已传上去的分段合成文件
  private leave() {
    window.removeEventListener('pagehide', this.onLeave);
    if (this.finished && this.recordId === null) return;
    if (this.recordId === null) return; // 还没开始成功：后台没有记录，无需处理
    this.finished = true;
    recordingsService.completeUploadOnLeave(
      this.siteId,
      this.recordId,
      Date.now() - this.startedAt,
    );
  }
  // end

  /** 停止录像时调用：传完剩余部分并合成。onProgress 收到“还剩几段”。返回 true = 已保存 */
  async finish(
    duration: number,
    onProgress?: (left: number) => void,
  ): Promise<boolean> {
    if (this.finished) return false;
    this.finished = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.cut();
    await this.startPromise;
    if (this.failed || this.recordId === null) {
      window.removeEventListener('pagehide', this.onLeave);
      return false;
    }
    // 等正在传的那一段结束，再把队列传完；最多再试 3 轮
    for (let round = 0; round < 3; round++) {
      while (this.pumping) {
        onProgress?.(this.queue.length);
        await sleep(200);
      }
      if (await this.pump(onProgress)) break;
    }
    // 传完之前页面若要离开，leave() 仍会兜底“完成”；走到这里说明页面还在
    window.removeEventListener('pagehide', this.onLeave);
    if (this.queue.length) {
      // 还有段没传上去：用已传的部分合成，保证后台有文件
      console.error('[pg-record] some parts not uploaded, completing with uploaded parts');
    }
    try {
      await recordingsService.completeUpload(this.siteId, this.recordId, duration);
      return true;
    } catch (e) {
      console.error('[pg-record] complete failed', e);
      return false;
    }
  }
}
// end
