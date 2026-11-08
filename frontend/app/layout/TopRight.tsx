import { Popover, Space } from 'antd';
import React from 'react';
import { getInitials } from 'App/utils';
import Notifications from 'Components/Alerts/Notifications/Notifications';
import HealthStatus from 'Components/Header/HealthStatus';
import UserMenu from 'Components/Header/UserMenu/UserMenu';
import SaasHeaderMenuItems from 'Components/Header/SaasHeaderMenuItems/SaasHeaderMenuItems';
import GettingStartedProgress from 'Shared/GettingStarted/GettingStartedProgress';
import ProjectDropdown from 'Shared/ProjectDropdown';
import { useStore } from 'App/mstore';
import { observer } from 'mobx-react-lite';
import ThemeToggle from 'Components/ThemeToggle';
import { hasHealth } from '@/utils/split-utils';
import { mobileScreen } from 'App/utils/isMobile';
import { PG_SOURCE_URL } from 'App/pgSource'; // add lee 2026.11.8 AGPL 源码链接

function TopRight() {
  const { userStore } = useStore();
  const { account } = userStore;

  const mobile = mobileScreen;
  return (
    <Space style={{ lineHeight: '0' }}>
      <SaasHeaderMenuItems />
      <ProjectDropdown />
      <GettingStartedProgress />

      <Notifications />

      {hasHealth && account.name ? <HealthStatus /> : null}
      {mobile ? null : <ThemeToggle />}
      {/* add lee 2026.11.8 AGPL-3.0 源码获取链接（登录后各页面含看屏页都显示） */}
      <a
        href={PG_SOURCE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-gray-500 hover:underline"
        style={{ lineHeight: '1.5' }}
      >
        Source
      </a>
      {/* end */}

      <Popover content={<UserMenu />} placement="topRight">
        <div className="flex items-center cursor-pointer">
          <div
            className="bg-tealx rounded-full flex items-center justify-center color-white"
            style={{ width: '32px', height: '32px' }}
          >
            {getInitials(account.name)}
          </div>
        </div>
      </Popover>
    </Space>
  );
}

export default observer(TopRight);
