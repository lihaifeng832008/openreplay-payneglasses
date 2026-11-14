-- add lee 2026.11.14 看屏录像登记表（api/routers/subs/pg_assist_records.py 使用）；每个环境的 OpenReplay PostgreSQL 执行一次，可重复执行
-- 回滚：DROP TABLE IF EXISTS public.pg_assist_records;（只删登记，对象存储里 assist-records/ 下的文件需另行处理）
CREATE TABLE IF NOT EXISTS public.pg_assist_records
(
    record_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id integer   NOT NULL REFERENCES public.projects (project_id) ON DELETE CASCADE,
    session_id bigint    NULL,
    user_id    integer   NULL REFERENCES public.users (user_id) ON DELETE SET NULL, -- 录制人；账号被物理删除时录像保留
    name       text      NOT NULL,
    duration   bigint    NOT NULL DEFAULT 0,
    file_key   text      NOT NULL UNIQUE,
    created_at timestamp NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS pg_assist_records_project_created_idx ON public.pg_assist_records (project_id, created_at DESC);
-- end

-- add lee 2026.11.14 边录边传（S3 分段上传）：状态、上传号、已传分段清单、最后更新时间
-- 已有记录取默认值 status='done'；回滚：依次 DROP COLUMN 这 4 列与下面的索引
ALTER TABLE public.pg_assist_records ADD COLUMN IF NOT EXISTS status     text      NOT NULL DEFAULT 'done'; -- uploading / done / interrupted
ALTER TABLE public.pg_assist_records ADD COLUMN IF NOT EXISTS upload_id  text      NULL;                   -- S3 分段上传号，完成后清空
ALTER TABLE public.pg_assist_records ADD COLUMN IF NOT EXISTS parts      jsonb     NOT NULL DEFAULT '[]'::jsonb; -- [{PartNumber, ETag}]
ALTER TABLE public.pg_assist_records ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT timezone('utc'::text, now());
CREATE INDEX IF NOT EXISTS pg_assist_records_uploading_idx ON public.pg_assist_records (updated_at) WHERE status = 'uploading';
-- end
