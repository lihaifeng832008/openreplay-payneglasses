import React from 'react';
import { useTranslation } from 'react-i18next';
import { PG_SOURCE_URL } from 'App/pgSource'; // add lee 2026.11.8 AGPL 源码链接

const Copyright = React.memo(() => {
  const currentYear = new Date().getFullYear();
  const { t } = useTranslation();
  return (
    <footer className="fixed bottom-0 m-auto text-center mb-6 text-gray-500">
      {`© ${currentYear} ${t('OpenReplay. All rights reserved')}. `}
      <a
        className="link"
        href="https://openreplay.com/legal/privacy"
        target="_blank"
        rel="noopener noreferrer"
      >
        {t('Privacy')}
      </a>
      &nbsp;{t('and')}&nbsp;
      <a
        className="link"
        href="https://openreplay.com/legal/terms"
        target="_blank"
        rel="noopener noreferrer"
      >
        {t('Terms')}
      </a>
      .
      {/* add lee 2026.11.8 AGPL-3.0 源码获取链接 */}
      &nbsp;
      <a className="link" href={PG_SOURCE_URL} target="_blank" rel="noopener noreferrer">
        Source code (AGPL-3.0)
      </a>
      {/* end */}
    </footer>
  );
});

export default Copyright;
