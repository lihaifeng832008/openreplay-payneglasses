// add lee 2026.11.14 Sessions 列表录像按钮：这个会话有看屏录像时显示摄像机按钮；1 条直接播放，多条弹出菜单选（数据来自 api/routers/subs/pg_assist_records.py）
import React from 'react';
import { Dropdown, Tooltip } from 'antd';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';

import { formatTimeOrDate, durationFromMs } from 'App/date';
import { useStore } from 'App/mstore';
import { recordingsService } from 'App/services';
import { IRecord } from 'App/services/RecordingsService';
import { Icon } from 'UI';

interface Props {
  records: IRecord[];
}

function PgRecordingLink({ records }: Props) {
  const { t } = useTranslation();
  const { settingsStore } = useStore();
  const { timezone } = settingsStore.sessionSettings;
  const [open, setOpen] = React.useState(false); // add lee 2026.11.14 多条录像菜单的开关

  const play = (recordId: number) => {
    recordingsService
      .fetchRecording(recordId)
      .then((rec) => {
        if (rec?.URL) window.open(rec.URL, '_blank');
        else toast.error(t("Couldn't open the recording"));
      })
      .catch(() => toast.error(t("Couldn't open the recording")));
  };

  // 不让点击冒泡到整行（整行点击会进回放）
  const stop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const label = (r: IRecord) =>
    `${formatTimeOrDate(r.createdAt, timezone, true)} · ${durationFromMs(r.duration)}${r.createdBy ? ` · ${r.createdBy}` : ''}`;

  const button = (
    <div
      className="mr-3 rounded-full border border-tealx p-2 hover:bg-tealx-lightest cursor-pointer flex items-center"
      onClick={(e) => {
        // modify lee 2026.11.14 多条时菜单由 Dropdown 自己在本元素上开关（原先外面另套一层，点击被这里拦住，点了没反应）
        // stop(e);
        // if (records.length === 1) play(records[0].recordId);
        e.stopPropagation();
        if (records.length === 1) {
          e.preventDefault();
          play(records[0].recordId);
        }
        // end
      }}
    >
      <Icon name="camera-video" size={18} color="tealx" />
      {records.length > 1 && (
        <span className="ml-1 text-xs text-tealx">{records.length}</span>
      )}
    </div>
  );

  if (records.length === 1) {
    return (
      <Tooltip title={`${t('Co-browse recording')}: ${label(records[0])}`}>
        {button}
      </Tooltip>
    );
  }

  return (
    <Dropdown
      trigger={['click']}
      open={open}
      onOpenChange={(v) => setOpen(v)}
      menu={{
        items: records.map((r) => ({ key: String(r.recordId), label: label(r) })),
        onClick: ({ key, domEvent }) => {
          domEvent.stopPropagation();
          setOpen(false);
          play(Number(key));
        },
      }}
    >
      {button}
    </Dropdown>
  );
}

export default PgRecordingLink;
// end
