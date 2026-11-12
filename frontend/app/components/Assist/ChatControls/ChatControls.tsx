import React, { useState } from 'react';
import cn from 'classnames';
import { Icon } from 'UI';
import { Button } from 'antd';
import type { LocalStream } from 'Player';
import stl from './ChatControls.module.css';
// add lee 2026.11.12 看屏通话视频开关：按项目设置 Assist 标签的开关决定是否显示视频按钮（接口 api/routers/subs/pg_assist.py）
import { useStore } from 'App/mstore';
import { projectsService } from 'App/services';
// end

interface Props {
  stream: LocalStream | null;
  endCall: () => void;
  videoEnabled: boolean;
  isPrestart?: boolean;
  setVideoEnabled: (isEnabled: boolean) => void;
}
function ChatControls({
  stream,
  endCall,
  videoEnabled,
  setVideoEnabled,
  isPrestart,
}: Props) {
  const [audioEnabled, setAudioEnabled] = useState(true);
  // add lee 2026.11.12 看屏通话视频开关：读到“允许”才显示视频按钮；读取中、读取失败一律不显示（与客户端默认一致）
  const { projectsStore } = useStore();
  const siteId = projectsStore.activeSiteId;
  const [callVideoAllowed, setCallVideoAllowed] = useState(false);
  React.useEffect(() => {
    if (!siteId) return;
    let alive = true;
    projectsService
      .fetchAssistSettings(`${siteId}`)
      .then((r) => {
        if (alive) setCallVideoAllowed(!!r?.data?.callVideo);
      })
      .catch(() => {
        if (alive) setCallVideoAllowed(false);
      });
    return () => {
      alive = false;
    };
  }, [siteId]);
  // end

  const toggleAudio = () => {
    if (!stream) {
      return;
    }
    setAudioEnabled(stream.toggleAudio());
  };

  const toggleVideo = () => {
    if (!stream) {
      return;
    }
    stream.toggleVideo().then((v) => setVideoEnabled(v));
  };

  /** muting user if he is auto connected to the call */
  React.useEffect(() => {
    if (isPrestart) {
      audioEnabled && toggleAudio();
    }
  }, []);

  return (
    <div
      className={cn(
        stl.controls,
        'flex items-center w-full justify-start bottom-0 px-2',
      )}
    >
      <div className="flex items-center gap-2">
        <div className={cn(stl.btnWrapper, { [stl.disabled]: audioEnabled })}>
          <Button
            size="small"
            variant="text"
            onClick={toggleAudio}
            icon={<Icon name={audioEnabled ? 'mic' : 'mic-mute'} size="16" />}
          >
            <span
              className={cn('ml-1 color-gray-medium text-sm', {
                'color-red': audioEnabled,
              })}
            >
              {audioEnabled ? 'Mute' : 'Unmute'}
            </span>
          </Button>
        </div>

        {/* modify lee 2026.11.12 看屏通话视频开关：项目设置不允许时不显示视频按钮 */}
        {callVideoAllowed ? (
        <div className={cn(stl.btnWrapper, { [stl.disabled]: videoEnabled })}>
          <Button
            size="small"
            variant="text"
            onClick={toggleVideo}
            icon={
              <Icon
                name={videoEnabled ? 'camera-video' : 'camera-video-off'}
                size="16"
              />
            }
          >
            <span
              className={cn('ml-1 color-gray-medium text-sm', {
                'color-red': videoEnabled,
              })}
            >
              {videoEnabled ? 'Stop Video' : 'Start Video'}
            </span>
          </Button>
        </div>
        ) : null}
        {/* end */}
      </div>
      <div className="ml-auto">
        <button className={stl.endButton} onClick={endCall}>
          END
        </button>
      </div>
    </div>
  );
}

export default ChatControls;
