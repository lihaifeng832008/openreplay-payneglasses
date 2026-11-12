// add lee 2026.11.12 看屏通话视频开关（Lee 11-12 定：放 OpenReplay 项目设置 Assist 标签，统一管客户端与坐席端，默认关）
// 关：客户端通话小窗用去掉“Start Video”的官方模板（api /pg/assist/call-ui/{projectKey}），坐席端通话窗也不显示视频按钮；
// 开：两端都恢复官方原样。接口见 api/routers/subs/pg_assist.py
import React, { useEffect, useState } from 'react';
import { Space, Switch, Tooltip, Typography } from 'antd';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';

import { useStore } from '@/mstore';
import Project from '@/mstore/types/project';
import { projectsService } from 'App/services';
import { Loader } from 'UI';

interface Props {
  project: Project;
}

function ProjectAssistSettings({ project }: Props) {
  const { t } = useTranslation();
  const { userStore } = useStore();
  const isAdmin = userStore.account.admin || userStore.account.superAdmin;
  const { projectId } = project;
  const [loadedFor, setLoadedFor] = useState<string | null>(null); // 已读到开关的项目；与当前项目不同即“读取中”
  const [saving, setSaving] = useState(false);
  const [callVideo, setCallVideo] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    projectsService
      .fetchAssistSettings(`${projectId}`)
      .then((r) => {
        if (alive) setCallVideo(!!r?.data?.callVideo);
      })
      .catch(() => {
        if (alive) toast.error(t('Failed to load assist settings'));
      })
      .finally(() => {
        if (alive) setLoadedFor(`${projectId}`);
      });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const onChange = (checked: boolean) => {
    setSaving(true);
    projectsService
      .saveAssistSettings(`${projectId}`, { callVideo: checked })
      .then((r) => {
        if (r?.errors) throw new Error(r.errors[0]);
        setCallVideo(!!r?.data?.callVideo);
        toast.success(t('Assist settings saved'));
      })
      .catch(() => toast.error(t('Failed to save assist settings')))
      .finally(() => setSaving(false));
  };

  return (
    <Loader loading={loadedFor !== `${projectId}`}>
      <div className="flex flex-col gap-4 border-b pb-4">
        <Space className="flex! items-center! gap-4!">
          <Tooltip title={isAdmin ? '' : t("You don't have permission to change.")}>
            <Switch
              checked={callVideo}
              onChange={onChange}
              loading={saving}
              disabled={!isAdmin}
            />
          </Tooltip>
          <Typography.Text strong>{t('Allow video in assist calls')}</Typography.Text>
        </Space>
        <Typography.Text type="secondary" style={{ maxWidth: '72ch' }}>
          {t(
            'When off, the call widget shown to the user has no "Start Video" button and agents cannot turn on their camera; audio calls and remote control are not affected. Applies to calls started after the change.',
          )}
        </Typography.Text>
      </div>
    </Loader>
  );
}

export default observer(ProjectAssistSettings);
// end
