import React from 'react';
import ovStl from 'Components/Session_/Player/Overlay/overlay.module.css';
import { ConnectionStatus } from 'Player';
import { Loader } from 'UI';
import { useTranslation } from 'react-i18next';

interface Props {
  connectionStatus: ConnectionStatus;
}

export default function LiveStatusText({ connectionStatus }: Props) {
  const { t } = useTranslation();
  const renderView = () => {
    switch (connectionStatus) {
      case ConnectionStatus.Closed:
        return (
          <div className="flex flex-col items-center text-center">
            <div className="text-lg -mt-8">{t('Session not found')}</div>
            <div className="text-sm">
              {t('The remote session doesn’t exist anymore.')}
              <br />{' '}
              {t(
                'The user may have closed the tab/browser while you were trying to establish a connection.',
              )}
            </div>
          </div>
        );

      case ConnectionStatus.Connecting:
        return (
          <div className="flex flex-col items-center">
            <Loader loading />
            <div className="text-lg -mt-8">{t('Connecting...')}</div>
            <div className="text-sm">
              {t('Establishing a connection with the remote session.')}
            </div>
          </div>
        );
      case ConnectionStatus.WaitingMessages:
        return (
          <div className="flex flex-col items-center">
            <Loader loading />
            <div className="text-lg -mt-8">
              {t('Waiting for the session to become active...')}
            </div>
            <div className="text-sm">
              {t(
                "If it's taking too much time, it could mean the user is simply inactive.",
              )}
            </div>
          </div>
        );
      case ConnectionStatus.Connected:
        return (
          <div className="flex flex-col items-center">
            <div className="text-lg -mt-8">{t('Connected')}</div>
          </div>
        );
      case ConnectionStatus.Inactive:
        return (
          <div className="flex flex-col items-center">
            <Loader loading />
            <div className="text-lg -mt-8">
              {t('Waiting for the session to become active...')}
            </div>
            <div className="text-sm">
              {t(
                "If it's taking too much time, it could mean the user is simply inactive.",
              )}
            </div>
          </div>
        );
      case ConnectionStatus.Disconnected:
        return (
          <div className="flex flex-col items-center">
            <div className="text-lg -mt-8">{t('Disconnected')}</div>
            <div className="text-sm">
              {t(
                'The connection was lost with the remote session. The user may have simply closed the tab/browser.',
              )}
            </div>
          </div>
        );
      case ConnectionStatus.Error:
        return (
          <div className="flex flex-col items-center">
            <div className="text-lg -mt-8">{t('Error')}</div>
            <div className="text-sm">
              {t('Something wrong just happened. Try refreshing the page.')}
            </div>
          </div>
        );
    }
  };
  // add lee 2026.11.14 客户把网页放到后台：不遮住画面（保留离开前最后的页面），只在顶部显示一条提示，不挡坐席操作
  if (connectionStatus === ConnectionStatus.Inactive) {
    return (
      <div
        style={{ pointerEvents: 'none' }}
        className="absolute top-0 left-0 right-0 z-10 flex justify-center"
      >
        <div className="mt-2 px-4 py-2 rounded-lg bg-yellow text-sm shadow">
          {t(
            'The customer switched to another tab or app. Showing the last page they viewed; it will update when they come back.',
          )}
        </div>
      </div>
    );
  }
  // end
  return <div className={ovStl.overlay}>{renderView()}</div>;
}
