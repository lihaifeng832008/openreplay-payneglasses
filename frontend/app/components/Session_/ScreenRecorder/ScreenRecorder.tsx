import React from 'react';
import { screenRecorder } from 'App/utils/screenRecorder';
import { Tooltip, Button } from 'antd';
import { Icon } from 'UI';
import { Disc } from 'lucide-react';
import { SessionRecordingStatus } from 'Player';
import { recordingsService } from 'App/services';
import { toast } from 'react-toastify';
import { formatTimeOrDate } from 'App/date';
import {
  PlayerContext,
  ILivePlayerContext,
} from 'App/components/Session/playerContext';
import { observer } from 'mobx-react-lite';
import { ENTERPRISE_REQUEIRED } from 'App/constants';
import { useStore } from 'App/mstore';
import { useTranslation } from 'react-i18next';
import PgRecordUploader from 'App/utils/pgRecordUploader'; // add lee 2026.11.14 边录边传

let stopRecorderCb: () => void;
let pgUploader: PgRecordUploader | null = null; // add lee 2026.11.14 当前这次录像的上传器

/**
 * "edge" || "edg/"   chromium based edge (dev or canary)
 * "chrome" && window.chrome   chrome
 * "opr" && (!!window.opr || !!window.opera)   opera
 * "trident"   ie
 * "firefox"   firefox
 * "safari"   safari
 */
function isSupported() {
  const agent = window.navigator.userAgent.toLowerCase();

  if (agent.includes('edge') || agent.includes('edg/')) return true;
  // @ts-ignore
  return agent.includes('chrome') && !!window.chrome;
}

const supportedBrowsers = ['Chrome v91+', 'Edge v90+'];
const supportedMessage = `Supported Browsers: ${supportedBrowsers.join(', ')}`;

function ScreenRecorder() {
  const { t } = useTranslation();
  const { projectsStore, sessionStore, userStore } = useStore();
  const { isEnterprise } = userStore;
  const agentId = userStore.account.id;
  const { sessionId } = sessionStore.current;
  const { siteId } = projectsStore;
  const { player, store } = React.useContext(
    PlayerContext,
  ) as ILivePlayerContext;
  const { recordingState } = store.get();

  const [isRecording, setRecording] = React.useState(false);

  React.useEffect(() => () => stopRecorderCb?.(), []);

  const onSave = async (
    saveObj: { name: string; duration: number },
    blob: Blob,
  ) => {
    // add lee 2026.11.14 边录边传：数据已一段段传给后台，这里只传完最后一段并合成一个文件
    if (pgUploader) {
      const uploader = pgUploader;
      pgUploader = null;
      // modify lee 2026.11.14 保存过程显示剩余段数，传完再提示成功
      // toast.info(t('Saving the recording...'));
      // const ok = await uploader.finish(saveObj.duration);
      // if (ok) toast.success(t('Session recording uploaded'));
      // else toast.error(t("Couldn't save the recording"));
      const TOAST_ID = 'pg-record-saving';
      const text = (left: number) =>
        left > 0
          ? `${t('Saving the recording')}… ${left} ${t('part(s) left')}`
          : `${t('Saving the recording')}…`;
      toast.info(text(uploader.remaining()), {
        toastId: TOAST_ID,
        autoClose: false,
      });
      const ok = await uploader.finish(saveObj.duration, (left) =>
        toast.update(TOAST_ID, { render: text(left) }),
      );
      toast.dismiss(TOAST_ID);
      if (ok) toast.success(t('Session recording uploaded'));
      else toast.error(t("Couldn't save the recording"));
      // end
      return;
    }
    // end
    // add lee 2026.11.14 录像机没出数据（0 字节）时不上传，直接提示
    if (!blob || blob.size === 0) {
      toast.error(t("Recording is empty, nothing was saved"));
      return;
    }
    // end
    try {
      toast.warn('Uploading the recording...');
      const { URL, key } = await recordingsService.reserveUrl(siteId, {
        ...saveObj,
        sessionId,
      });
      const status = await recordingsService.saveFile(URL, blob);

      if (status) {
        await recordingsService.confirmFile(
          siteId,
          { ...saveObj, sessionId },
          key,
        );
        toast.success(t('Session recording uploaded'));
      }
    } catch (e) {
      console.error(e);
      toast.error(t("Couldn't upload the file"));
    }
  };

  React.useEffect(() => {
    if (!isRecording && recordingState === SessionRecordingStatus.Recording) {
      void startRecording();
    }
    if (isRecording && recordingState !== SessionRecordingStatus.Recording) {
      stopRecordingHandler();
    }
  }, [recordingState, isRecording]);

  const onStop = () => {
    setRecording(false);
    player.assistManager.stopRecording();
  };

  const startRecording = async () => {
    try {
      // modify lee 2026.11.14 边录边传：录像器每段数据交给上传器
      const recName = `${formatTimeOrDate(new Date().getTime(), undefined, true)}_${sessionId}`;
      let uploader: PgRecordUploader | null = null;
      // @ts-ignore
      stopRecorderCb = await screenRecorder(
        recName,
        sessionId,
        onSave,
        onStop,
        (chunk: Blob) => uploader?.push(chunk),
      );
      // 屏幕共享已获准才开始上传（首段数据 200ms 后才到，这里同步创建来得及）
      uploader = new PgRecordUploader(siteId as string, sessionId, recName);
      pgUploader = uploader;
      // end
      setRecording(true);
    } catch (e) {
      stopRecordingHandler();
      console.error(e);
    }
  };

  const stopRecordingHandler = () => {
    player.assistManager.ping('s_recording_ended', agentId);
    stopRecorderCb?.();
    onStop();
  };

  const recordingRequest = () => {
    const onDeny = () =>
      toast.info(t('Recording request was rejected by user'));
    player.assistManager.requestRecording({ onDeny });
  };

  React.useEffect(() => {
    if (isRecording) {
      player.assistManager.ping('s_recording_started', agentId);
    }
  }, [isRecording]);

  // modify lee 2026.11.14 看屏录像改由自家接口 api/routers/subs/pg_assist_records.py 保存，开源版也放开（只限浏览器支持）
  // if (!isSupported() || !isEnterprise) {
  if (!isSupported()) {
  // end
    return (
      <div className="p-2">
        {/* @ts-ignore */}
        <Tooltip
          title={isEnterprise ? supportedMessage : ENTERPRISE_REQUEIRED(t)}
        >
          <Button icon={<Disc size={16} />} disabled type="text">
            {t('Record Activity')}
          </Button>
        </Tooltip>
      </div>
    );
  }

  return (
    <div
      onClick={!isRecording ? recordingRequest : stopRecordingHandler}
      className="p-2"
    >
      <Button
        icon={
          <Icon
            name={!isRecording ? 'stop-record-circle' : 'record-circle'}
            size={16}
          />
        }
        type="text"
        className={isRecording ? 'text-red' : 'text-main'}
      >
        {isRecording ? t('Stop Recording') : t('Record Activity')}
      </Button>
    </div>
  );
}

export default observer(ScreenRecorder);
