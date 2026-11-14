import { toast } from 'react-toastify';

class AudioContextManager {
  context = new AudioContext();

  destination = this.context.createMediaStreamDestination();

  getAllTracks() {
    return this.destination.stream.getAudioTracks() || [];
  }

  mergeAudioStreams(stream: MediaStream) {
    const source = this.context.createMediaStreamSource(stream);
    const gain = this.context.createGain();
    gain.gain.value = 0.7;
    return source.connect(gain).connect(this.destination);
  }

  // add lee 2026.11.14 静音底音：没有通话时混音轨不出数据，Chrome 录像机会连画面一起录成 0 字节（main 11-14 21:34 实测；
  // 本机复现：无通话 0 块 0 字节，加音量 0 的振荡器后 11 块）。每个混音器只接一次，clear() 换了混音器后下次录像重接
  silentFor: AudioContext | null = null;

  keepAudioAlive() {
    if (this.silentFor === this.context) return;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(this.destination);
    osc.start();
    this.silentFor = this.context;
  }
  // end

  clear() {
    // when everything is removed, tracks will be stopped automatically (hopefully)
    this.context = new AudioContext();
    this.destination = this.context.createMediaStreamDestination();
  }
}

export const audioContextManager = new AudioContextManager();

const FILE_TYPE = 'video/webm';
const FRAME_RATE = 30;

function createFileRecorder(
  stream: MediaStream,
  mimeType: string,
  recName: string,
  sessionId: string,
  saveCb: (saveObj: { name: string; duration: number }, blob: Blob) => void,
  onStop: () => void,
  onChunk?: (chunk: Blob) => void, // add lee 2026.11.14 边录边传：每段数据交给上传器，不在内存里攒整段
) {
  let ended = false;
  const start = new Date().getTime();

  let recordedChunks: BlobPart[] = [];
  const SAVE_INTERVAL_MS = 200;
  const mediaRecorder = new MediaRecorder(stream, {
    // modify lee 2026.11.14 看屏录像：画面 + 看屏通话声音（Lee 11-14 晚加上录音），恢复官方编码
    // mimeType: 'video/webm; codecs=vp8',
    mimeType: 'video/webm; codecs=vp8,opus',
    // end
    // add lee 2026.11.14 限定码率：画面约 1Mbps + 声音 64kbps，约每分钟 7.5MB（原默认约 17MB/分钟），上传更快
    videoBitsPerSecond: 1_000_000,
    audioBitsPerSecond: 64_000,
    // end
  });

  mediaRecorder.ondataavailable = function (e) {
    if (e.data.size > 0) {
      // modify lee 2026.11.14 边录边传时交给上传器，不再攒在内存里
      // recordedChunks.push(e.data);
      if (onChunk) onChunk(e.data);
      else recordedChunks.push(e.data);
      // end
    }
  };

  function onEnd() {
    if (ended) return;

    ended = true;
    saveFile(recordedChunks, mimeType, start, recName, sessionId, saveCb);
    onStop();
    recordedChunks = [];
  }

  // sometimes we get race condition or the onstop won't trigger at all,
  // this is why we have to make it twice to make sure that stream is saved
  // plus we want to be able to handle both, native and custom button clicks
  // modify lee 2026.11.14 坐席点浏览器“停止共享”时，先让录像器停下交出最后一段（onstop 再收尾），否则最后一段丢失
  // mediaRecorder.stream.getTracks().forEach((track) => (track.onended = onEnd));
  mediaRecorder.stream.getTracks().forEach(
    (track) =>
      (track.onended = () => {
        if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
        else onEnd();
      }),
  );
  // end
  mediaRecorder.onstop = () => {
    onEnd();
    mediaRecorder.stream.getTracks().forEach((track) => track.stop());
  };
  mediaRecorder.start(SAVE_INTERVAL_MS);

  return mediaRecorder;
}

function saveFile(
  recordedChunks: BlobPart[],
  mimeType: string,
  startDate: number,
  recName: string,
  sessionId: string,
  saveCb: (saveObj: { name: string; duration: number }, blob: Blob) => void,
) {
  const saveObject = {
    name: recName,
    duration: new Date().getTime() - startDate,
    sessionId,
  };

  const blob = new Blob(recordedChunks, {
    type: mimeType,
  });
  saveCb(saveObject, blob);

  // delete lee 2026.11.14 看屏录像只存对象存储，不再同时下载到坐席电脑
  // const filename = `${recName}.${mimeType.split('/')[1]}`;
  // const downloadLink = document.createElement('a');
  // downloadLink.href = URL.createObjectURL(blob);
  // downloadLink.download = filename;
  //
  // document.body.appendChild(downloadLink);
  // downloadLink.click();
  //
  // URL.revokeObjectURL(downloadLink.href); // clear from memory
  // document.body.removeChild(downloadLink);
  // end
}

async function recordScreen() {
  // add lee 2026.11.14 看屏录像：画面取坐席当前标签页；声音只取看屏通话（客户声音 + 坐席麦克风，
  // 通话建立时 AssistActions.tsx 已并入 audioContextManager），不录标签页声音，免得通话声录两遍
  // 用通话混音轨的副本：录像结束停的是副本，不会把混音轨停掉，同一看屏里第二次录像仍有声音
  const videoOnly = await navigator.mediaDevices.getDisplayMedia({
    audio: false,
    video: { frameRate: FRAME_RATE },
    // @ts-ignore 默认选中当前标签页（坐席看屏的这一页）
    preferCurrentTab: true,
  });
  // 混音器若因浏览器自动播放限制处于暂停状态，录出来是静音：录像开始时唤醒一次
  if (audioContextManager.context.state === 'suspended') {
    void audioContextManager.context.resume().catch(() => undefined);
  }
  audioContextManager.keepAudioAlive(); // add lee 2026.11.14 没有通话也要让音轨出数据，否则整段录像 0 字节
  return new MediaStream([
    ...videoOnly.getVideoTracks(),
    ...audioContextManager.getAllTracks().map((track) => track.clone()),
  ]);
  // end
  // delete lee 2026.11.14 原有录音、混音逻辑保留不用
  // const desktopStreams = await navigator.mediaDevices.getDisplayMedia({
  //   audio: {
  //     // @ts-ignore
  //     restrictOwnAudio: false,
  //     echoCancellation: true,
  //     noiseSuppression: true,
  //     sampleRate: 44100,
  //   },
  //   video: { frameRate: FRAME_RATE },
  //   // potential chrome hack
  //   // @ts-ignore
  //   preferCurrentTab: true,
  // });
  // audioContextManager.mergeAudioStreams(desktopStreams);
  // return new MediaStream([
  //   ...desktopStreams.getVideoTracks(),
  //   ...audioContextManager.getAllTracks(),
  // ]);
  // end
}

/**
 * Creates a screen recorder that sends the media stream to MediaRecorder
 * which then saves the stream to a file.
 *
 * Supported Browsers:
 *
 *      Windows: Chrome v91+, Edge v90+ - FULL SUPPORT;
 *      *Nix: Chrome v91+, Edge v90+ - LIMITED SUPPORT - (audio only captured from current tab)
 *
 * @returns  a promise that resolves to a function that stops the recording
 */
export async function screenRecorder(
  recName: string,
  sessionId: string,
  saveCb: (
    saveObj: {
      name: string;
      duration: number;
    },
    blob: Blob,
  ) => void,
  onStop: () => void,
  onChunk?: (chunk: Blob) => void, // add lee 2026.11.14 边录边传
) {
  try {
    const stream = await recordScreen();
    const mediaRecorder = createFileRecorder(
      stream,
      FILE_TYPE,
      recName,
      sessionId,
      saveCb,
      onStop,
      onChunk, // add lee 2026.11.14 边录边传
    );

    return () => {
      if (mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        onStop();
      }
    };
  } catch (e) {
    toast.error(
      'Screen recording is not permitted by your system and/or browser. Make sure to enable it in your browser as well as in your system settings.',
    );
    throw new Error(`OpenReplay recording: ${e}`);
  }
}

// NOT SUPPORTED:
// macOS:  chrome and edge only support capturing current tab's audio
// windows: chrome and edge supports all audio
// other: not supported
