# add lee 2026.11.14 看屏录像（Lee 11-14 定方案 B：只录坐席看到的画面、不录声音、永久存对象存储、可手动删除）
# 按开源版前端 frontend/app/services/RecordingsService.ts 已有的调用约定自行实现（不参照 ee/ 企业版代码）：
#   PUT    /{projectId}/assist/save                 申请上传地址（坐席浏览器拿到后直接 PUT 到对象存储）
#   PUT    /{projectId}/assist/save/done            上传完成后登记
#   POST   /{projectId}/assist/records              列表（分页 / 名称搜索 / 时间范围）
#   GET    /{projectId}/assist/records/{recordId}   取一条，带临时播放地址 URL
#   POST   /{projectId}/assist/records/{recordId}   改名（录制人或 owner / admin）
#   DELETE /{projectId}/assist/records/{recordId}   删除：对象存储文件和表记录一起真删（录制人或 owner / admin）
#   POST   /{projectId}/assist/records/by-sessions  按一页会话号批量查录像（Sessions 列表录像按钮用；add lee 2026.11.14）
# add lee 2026.11.14 边录边传（Lee 11-14 定：只经 OpenReplay 后台上传，不改 S3 跨域；生产入口 nginx 单次请求上限 10MB）
#   POST   /{projectId}/assist/upload/start                 开始：S3 分段上传 + 表里登记一条“上传中”
#   POST   /{projectId}/assist/upload/{recordId}/part/{n}   传第 n 段（请求体为原始二进制，约 6MB；同段号重传覆盖）
#   POST   /{projectId}/assist/upload/{recordId}/complete   完成：S3 按段号拼成一个文件，记录改“已完成”
#   POST   /{projectId}/assist/upload/{recordId}/abort      放弃：删 S3 已传分段与记录
#   定时任务每 10 分钟：“上传中”超 30 分钟无新分段 → 有分段就拼成文件（标 interrupted），没有就放弃
# end
# 表结构见 api/pg_assist/assist_records.sql（public.pg_assist_records），文件放 <桶>/assist-records/<项目>/<会话>/<随机名>.webm
# 桶默认沿用 sessions_bucket；环境变量 PG_ASSIST_RECORDS_BUCKET 可单独指定（该桶不能配到期删除规则，否则不是永久保存）
import json  # add lee 2026.11.14 分段清单写库
import logging
import re
import uuid
from typing import Literal, Optional

from decouple import config
from fastapi import Body, Depends, Request
from starlette.concurrency import run_in_threadpool  # add lee 2026.11.14 分段上传在线程池里跑，不阻塞接口
from apscheduler.triggers.interval import IntervalTrigger  # add lee 2026.11.14 中断上传收尾任务
from pydantic import BaseModel, Field

import schemas
from chalicelib.utils import pg_client
from chalicelib.utils.storage import StorageClient
from or_dependencies import OR_context
from routers.base import get_routers

logger = logging.getLogger(__name__)
public_app, app, app_apikey = get_routers()

KEY_PREFIX = "assist-records"
UPLOAD_EXPIRES = 3600  # 申请到上传地址后 1 小时内要传完
PLAY_EXPIRES = 3600  # 播放地址 1 小时有效
_SESSION_ID = re.compile(r"^\d{1,20}$")


def _bucket():
    return config("PG_ASSIST_RECORDS_BUCKET", default=None) or config("sessions_bucket")


class PgRecordSaveSchema(BaseModel):
    name: str = Field(..., min_length=1, max_length=300)
    duration: int = Field(default=0, ge=0)
    sessionId: Optional[str] = Field(default=None)


class PgRecordDoneSchema(PgRecordSaveSchema):
    key: str = Field(..., min_length=1, max_length=500)


class PgRecordSearchSchema(BaseModel):
    page: int = Field(default=1, ge=1)
    limit: int = Field(default=10, ge=1, le=200)
    order: Literal["asc", "desc"] = Field(default="desc")
    query: Optional[str] = Field(default=None)
    startTimestamp: Optional[int] = Field(default=None)
    endTimestamp: Optional[int] = Field(default=None)


# add lee 2026.11.14 Sessions 列表按会话号批量查录像
class PgRecordBySessionsSchema(BaseModel):
    sessionIds: list[str] = Field(default_factory=list, max_length=200)
# end


class PgRecordRenameSchema(BaseModel):
    name: str = Field(..., min_length=1, max_length=300)


def _session_id(value):
    value = str(value or "").strip()
    return int(value) if _SESSION_ID.match(value) else None


def _get(project_id: int, record_id: int):
    with pg_client.PostgresClient() as cur:
        query = cur.mogrify("""SELECT r.record_id, r.project_id, r.session_id, r.user_id, r.name, r.duration, r.file_key,
                                      r.status, r.upload_id, -- add lee 2026.11.14 边录边传
                                      (EXTRACT(EPOCH FROM r.created_at) * 1000)::bigint AS created_at,
                                      COALESCE(NULLIF(u.name, ''), u.email) AS created_by
                               FROM public.pg_assist_records AS r
                                        LEFT JOIN public.users AS u USING (user_id)
                               WHERE r.project_id = %(project_id)s
                                 AND r.record_id = %(record_id)s;""",
                            {"project_id": project_id, "record_id": record_id})
        cur.execute(query=query)
        return cur.fetchone()


def _to_api(row):
    # modify lee 2026.11.14 会话号 19 位超出浏览器整数精度，改按字符串返回
    # return {"recordId": row["record_id"], "sessionId": row["session_id"], "userId": row["user_id"],
    return {"recordId": row["record_id"],
            "sessionId": str(row["session_id"]) if row["session_id"] is not None else None,
            "userId": row["user_id"],
            # end
            "name": row["name"], "duration": row["duration"], "createdAt": row["created_at"],
            "createdBy": row["created_by"]}


def _can_edit(row, context: schemas.CurrentContext):
    return row["user_id"] == context.user_id or context.role in ("owner", "admin")


@app.put('/{projectId}/assist/save', tags=["assist", "pg-assist-records"])
def pg_reserve_record_url(projectId: int, data: PgRecordSaveSchema = Body(...),
                          context: schemas.CurrentContext = Depends(OR_context)):
    session_id = _session_id(data.sessionId)
    key = f"{KEY_PREFIX}/{projectId}/{session_id or 'none'}/{uuid.uuid4().hex}.webm"
    url = StorageClient.client.generate_presigned_url(
        'put_object', Params={'Bucket': _bucket(), 'Key': key}, ExpiresIn=UPLOAD_EXPIRES)
    return {"data": {"URL": url, "key": key}}


@app.put('/{projectId}/assist/save/done', tags=["assist", "pg-assist-records"])
def pg_confirm_record(projectId: int, data: PgRecordDoneSchema = Body(...),
                      context: schemas.CurrentContext = Depends(OR_context)):
    # 只认本项目前缀下、确实已传到对象存储的文件，防止登记别的项目或不存在的文件
    if not data.key.startswith(f"{KEY_PREFIX}/{projectId}/") or ".." in data.key:
        return {"errors": ["invalid key"]}
    if not StorageClient.exists(bucket=_bucket(), key=data.key):
        return {"errors": ["file not uploaded"]}
    # add lee 2026.11.14 空文件（录像机没出数据，11-14 21:34 出过一次 0 字节）不登记，顺手删掉
    if StorageClient.client.head_object(Bucket=_bucket(), Key=data.key).get("ContentLength", 0) <= 0:
        StorageClient.client.delete_object(Bucket=_bucket(), Key=data.key)
        return {"errors": ["empty recording"]}
    # end
    with pg_client.PostgresClient() as cur:
        query = cur.mogrify("""INSERT INTO public.pg_assist_records (project_id, session_id, user_id, name, duration, file_key)
                               VALUES (%(project_id)s, %(session_id)s, %(user_id)s, %(name)s, %(duration)s, %(file_key)s)
                               ON CONFLICT (file_key) DO NOTHING
                               RETURNING record_id;""",
                            {"project_id": projectId, "session_id": _session_id(data.sessionId),
                             "user_id": context.user_id, "name": data.name.strip(), "duration": data.duration,
                             "file_key": data.key})
        cur.execute(query=query)
        row = cur.fetchone()
    if row is None:
        return {"errors": ["already saved"]}
    logger.info(f"pg_assist_records: project {projectId} record {row['record_id']} saved by user {context.user_id}")
    return {"data": _to_api(_get(projectId, row["record_id"]))}


@app.post('/{projectId}/assist/records', tags=["assist", "pg-assist-records"])
def pg_search_records(projectId: int, data: PgRecordSearchSchema = Body(...),
                      context: schemas.CurrentContext = Depends(OR_context)):
    conditions = ["r.project_id = %(project_id)s",
                  "r.status <> 'uploading'"]  # add lee 2026.11.14 边录边传中的不进列表
    params = {"project_id": projectId, "limit": data.limit, "offset": (data.page - 1) * data.limit}
    if data.query and data.query.strip():
        conditions.append("r.name ILIKE %(query)s")
        params["query"] = f"%{data.query.strip()}%"
    if data.startTimestamp:
        conditions.append("r.created_at >= to_timestamp(%(start)s / 1000.0) AT TIME ZONE 'UTC'")
        params["start"] = data.startTimestamp
    if data.endTimestamp:
        conditions.append("r.created_at <= to_timestamp(%(end)s / 1000.0) AT TIME ZONE 'UTC'")
        params["end"] = data.endTimestamp
    order = "DESC" if data.order == "desc" else "ASC"
    with pg_client.PostgresClient() as cur:
        query = cur.mogrify(f"""SELECT COUNT(1) OVER () AS total, r.record_id, r.session_id, r.user_id, r.name, r.duration,
                                       (EXTRACT(EPOCH FROM r.created_at) * 1000)::bigint AS created_at,
                                       COALESCE(NULLIF(u.name, ''), u.email) AS created_by
                                FROM public.pg_assist_records AS r
                                         LEFT JOIN public.users AS u USING (user_id)
                                WHERE {" AND ".join(conditions)}
                                ORDER BY r.created_at {order}, r.record_id {order}
                                LIMIT %(limit)s OFFSET %(offset)s;""", params)
        cur.execute(query=query)
        rows = cur.fetchall()
    return {"data": {"total": rows[0]["total"] if rows else 0, "records": [_to_api(r) for r in rows]}}


# add lee 2026.11.14 Sessions 列表录像按钮：一页会话号一次查完，返回 {会话号字符串: [录像…]}，没有录像的会话不出现
@app.post('/{projectId}/assist/records/by-sessions', tags=["assist", "pg-assist-records"])
def pg_records_by_sessions(projectId: int, data: PgRecordBySessionsSchema = Body(...),
                           context: schemas.CurrentContext = Depends(OR_context)):
    ids = sorted({int(s) for s in data.sessionIds if _SESSION_ID.match(str(s).strip())})
    if not ids:
        return {"data": {}}
    with pg_client.PostgresClient() as cur:
        query = cur.mogrify("""SELECT r.record_id, r.session_id, r.user_id, r.name, r.duration,
                                      (EXTRACT(EPOCH FROM r.created_at) * 1000)::bigint AS created_at,
                                      COALESCE(NULLIF(u.name, ''), u.email) AS created_by
                               FROM public.pg_assist_records AS r
                                        LEFT JOIN public.users AS u USING (user_id)
                               WHERE r.project_id = %(project_id)s
                                 AND r.session_id = ANY (%(ids)s::bigint[])
                                 AND r.status <> 'uploading' -- add lee 2026.11.14 边录边传中的不显示
                               ORDER BY r.created_at, r.record_id;""",
                            {"project_id": projectId, "ids": ids})
        cur.execute(query=query)
        rows = cur.fetchall()
    result = {}
    for r in rows:
        result.setdefault(str(r["session_id"]), []).append(_to_api(r))
    return {"data": result}
# end


@app.get('/{projectId}/assist/records/{recordId}', tags=["assist", "pg-assist-records"])
def pg_get_record(projectId: int, recordId: int, context: schemas.CurrentContext = Depends(OR_context)):
    row = _get(projectId, recordId)
    if row is None:
        return {"errors": ["record not found"]}
    result = _to_api(row)
    result["URL"] = StorageClient.client.generate_presigned_url(
        'get_object', Params={'Bucket': _bucket(), 'Key': row["file_key"], 'ResponseContentType': 'video/webm'},
        ExpiresIn=PLAY_EXPIRES)
    return {"data": result}


@app.post('/{projectId}/assist/records/{recordId}', tags=["assist", "pg-assist-records"])
def pg_rename_record(projectId: int, recordId: int, data: PgRecordRenameSchema = Body(...),
                     context: schemas.CurrentContext = Depends(OR_context)):
    row = _get(projectId, recordId)
    if row is None:
        return {"errors": ["record not found"]}
    if not _can_edit(row, context):
        return {"errors": ["only the recorder or an admin can rename this recording"]}
    with pg_client.PostgresClient() as cur:
        query = cur.mogrify("""UPDATE public.pg_assist_records
                               SET name = %(name)s
                               WHERE project_id = %(project_id)s
                                 AND record_id = %(record_id)s;""",
                            {"project_id": projectId, "record_id": recordId, "name": data.name.strip()})
        cur.execute(query=query)
    return {"data": _to_api(_get(projectId, recordId))}


@app.delete('/{projectId}/assist/records/{recordId}', tags=["assist", "pg-assist-records"])
def pg_delete_record(projectId: int, recordId: int, context: schemas.CurrentContext = Depends(OR_context)):
    row = _get(projectId, recordId)
    if row is None:
        return {"errors": ["record not found"]}
    if not _can_edit(row, context):
        return {"errors": ["only the recorder or an admin can delete this recording"]}
    # 先删文件再删记录：文件删失败就保留记录，不会出现“记录没了、文件还在”的孤儿文件
    # modify lee 2026.11.14 还在上传中的是分段上传，要放弃上传（删已传分段），不是删文件
    # StorageClient.client.delete_object(Bucket=_bucket(), Key=row["file_key"])
    if row.get("status") == "uploading" and row.get("upload_id"):
        _abort_s3(row["file_key"], row["upload_id"])
    else:
        StorageClient.client.delete_object(Bucket=_bucket(), Key=row["file_key"])
    # end
    with pg_client.PostgresClient() as cur:
        query = cur.mogrify("""DELETE FROM public.pg_assist_records
                               WHERE project_id = %(project_id)s
                                 AND record_id = %(record_id)s;""",
                            {"project_id": projectId, "record_id": recordId})
        cur.execute(query=query)
    logger.info(f"pg_assist_records: project {projectId} record {recordId} ({row['file_key']}) deleted by user {context.user_id}")
    return {"data": {"state": "success"}}
# end


# add lee 2026.11.14 边录边传：S3 分段上传（create_multipart_upload → upload_part × n → complete_multipart_upload）
# S3 按段号升序把各段首尾相接成一个对象；除最后一段外每段至少 5MB（前端每段约 6MB），段号 1–10000
PART_MAX_BYTES = 9 * 1024 * 1024  # 入口 nginx 单次 10MB，这里多留一点余量
STALE_MINUTES = 30  # “上传中”超过这么久没有新分段，视为中断


class PgUploadStartSchema(BaseModel):
    name: str = Field(..., min_length=1, max_length=300)
    sessionId: Optional[str] = Field(default=None)


class PgUploadCompleteSchema(BaseModel):
    duration: int = Field(default=0, ge=0)


def _abort_s3(key, upload_id):
    try:
        StorageClient.client.abort_multipart_upload(Bucket=_bucket(), Key=key, UploadId=upload_id)
    except Exception as e:  # 已完成 / 已放弃的上传号再放弃会报 NoSuchUpload，忽略
        logger.warning(f"pg_assist_records: abort {key} {type(e).__name__} {str(e)[:120]}")


def _uploading(project_id, record_id, user_id):
    with pg_client.PostgresClient() as cur:
        query = cur.mogrify("""SELECT record_id, file_key, upload_id, parts, user_id
                               FROM public.pg_assist_records
                               WHERE project_id = %(project_id)s
                                 AND record_id = %(record_id)s
                                 AND status = 'uploading';""",
                            {"project_id": project_id, "record_id": record_id})
        cur.execute(query=query)
        row = cur.fetchone()
    if row is None or row["user_id"] != user_id:  # 只有开始上传的坐席本人能续传 / 完成
        return None
    return row


def _finish(project_id, record_id, key, upload_id, parts, status, duration=None):
    """按段号排好序交给 S3 合成；成功后改状态。没有任何分段就放弃并删记录。返回 True=已合成"""
    parts = sorted(parts or [], key=lambda x: int(x["PartNumber"]))
    if not parts:
        _abort_s3(key, upload_id)
        with pg_client.PostgresClient() as cur:
            cur.execute(cur.mogrify("DELETE FROM public.pg_assist_records WHERE project_id = %(p)s AND record_id = %(r)s;",
                                    {"p": project_id, "r": record_id}))
        return False
    StorageClient.client.complete_multipart_upload(
        Bucket=_bucket(), Key=key, UploadId=upload_id,
        MultipartUpload={"Parts": [{"PartNumber": int(x["PartNumber"]), "ETag": x["ETag"]} for x in parts]})
    with pg_client.PostgresClient() as cur:
        query = cur.mogrify("""UPDATE public.pg_assist_records
                               SET status     = %(status)s,
                                   upload_id  = NULL,
                                   duration   = COALESCE(%(duration)s,
                                                         (EXTRACT(EPOCH FROM (updated_at - created_at)) * 1000)::bigint),
                                   updated_at = timezone('utc'::text, now())
                               WHERE project_id = %(p)s
                                 AND record_id = %(r)s;""",
                            {"status": status, "duration": duration, "p": project_id, "r": record_id})
        cur.execute(query=query)
    return True


@app.post('/{projectId}/assist/upload/start', tags=["assist", "pg-assist-records"])
def pg_upload_start(projectId: int, data: PgUploadStartSchema = Body(...),
                    context: schemas.CurrentContext = Depends(OR_context)):
    session_id = _session_id(data.sessionId)
    key = f"{KEY_PREFIX}/{projectId}/{session_id or 'none'}/{uuid.uuid4().hex}.webm"
    r = StorageClient.client.create_multipart_upload(Bucket=_bucket(), Key=key, ContentType="video/webm")
    with pg_client.PostgresClient() as cur:
        query = cur.mogrify("""INSERT INTO public.pg_assist_records (project_id, session_id, user_id, name, duration, file_key,
                                                                     status, upload_id)
                               VALUES (%(project_id)s, %(session_id)s, %(user_id)s, %(name)s, 0, %(file_key)s,
                                       'uploading', %(upload_id)s)
                               RETURNING record_id;""",
                            {"project_id": projectId, "session_id": session_id, "user_id": context.user_id,
                             "name": data.name.strip(), "file_key": key, "upload_id": r["UploadId"]})
        cur.execute(query=query)
        record_id = cur.fetchone()["record_id"]
    logger.info(f"pg_assist_records: project {projectId} record {record_id} upload started by user {context.user_id}")
    return {"data": {"recordId": record_id}}


@app.post('/{projectId}/assist/upload/{recordId}/part/{partNumber}', tags=["assist", "pg-assist-records"])
async def pg_upload_part(projectId: int, recordId: int, partNumber: int, request: Request,
                         context: schemas.CurrentContext = Depends(OR_context)):
    if partNumber < 1 or partNumber > 10000:
        return {"errors": ["invalid part number"]}
    body = await request.body()
    if not body:
        return {"errors": ["empty part"]}
    if len(body) > PART_MAX_BYTES:
        return {"errors": ["part too large"]}
    row = await run_in_threadpool(_uploading, projectId, recordId, context.user_id)
    if row is None:
        return {"errors": ["upload not found"]}

    def _put():
        r = StorageClient.client.upload_part(Bucket=_bucket(), Key=row["file_key"], UploadId=row["upload_id"],
                                             PartNumber=partNumber, Body=body)
        part = {"PartNumber": partNumber, "ETag": r["ETag"]}
        # 同段号重传：去掉旧的再加新的（与 S3 “同段号覆盖”一致）
        with pg_client.PostgresClient() as cur:
            query = cur.mogrify("""UPDATE public.pg_assist_records
                                   SET parts      = COALESCE((SELECT jsonb_agg(x)
                                                              FROM jsonb_array_elements(parts) AS x
                                                              WHERE (x ->> 'PartNumber')::int <> %(n)s), '[]'::jsonb)
                                                    || jsonb_build_array(%(part)s::jsonb),
                                       updated_at = timezone('utc'::text, now())
                                   WHERE project_id = %(p)s
                                     AND record_id = %(r)s
                                     AND status = 'uploading';""",
                                {"n": partNumber, "part": json.dumps(part), "p": projectId, "r": recordId})
            cur.execute(query=query)
        return part

    # modify lee 2026.11.14 已“完成”（如离开页面时的 keepalive 完成）后才到的分段：S3 报 NoSuchUpload，按“上传已结束”返回，不报 500
    # part = await run_in_threadpool(_put)
    try:
        part = await run_in_threadpool(_put)
    except Exception as e:
        if "NoSuchUpload" in f"{type(e).__name__} {e}":
            return {"errors": ["upload already finished"]}
        raise
    # end
    return {"data": {"partNumber": part["PartNumber"], "size": len(body)}}


@app.post('/{projectId}/assist/upload/{recordId}/complete', tags=["assist", "pg-assist-records"])
def pg_upload_complete(projectId: int, recordId: int, data: PgUploadCompleteSchema = Body(...),
                       context: schemas.CurrentContext = Depends(OR_context)):
    row = _uploading(projectId, recordId, context.user_id)
    if row is None:
        return {"errors": ["upload not found"]}
    if not _finish(projectId, recordId, row["file_key"], row["upload_id"], row["parts"], "done", data.duration):
        return {"errors": ["empty recording"]}
    logger.info(f"pg_assist_records: project {projectId} record {recordId} completed, {len(row['parts'])} parts")
    return {"data": _to_api(_get(projectId, recordId))}


@app.post('/{projectId}/assist/upload/{recordId}/abort', tags=["assist", "pg-assist-records"])
def pg_upload_abort(projectId: int, recordId: int, context: schemas.CurrentContext = Depends(OR_context)):
    row = _uploading(projectId, recordId, context.user_id)
    if row is None:
        return {"errors": ["upload not found"]}
    _abort_s3(row["file_key"], row["upload_id"])
    with pg_client.PostgresClient() as cur:
        cur.execute(cur.mogrify("DELETE FROM public.pg_assist_records WHERE project_id = %(p)s AND record_id = %(r)s;",
                                {"p": projectId, "r": recordId}))
    return {"data": {"state": "aborted"}}


def _close_stale_uploads():
    """中断收尾：浏览器崩溃 / 关闭 / 断网没恢复时，把已传分段拼成文件（interrupted），一段都没有就放弃"""
    with pg_client.PostgresClient() as cur:
        query = cur.mogrify("""SELECT project_id, record_id, file_key, upload_id, parts
                               FROM public.pg_assist_records
                               WHERE status = 'uploading'
                                 AND updated_at < timezone('utc'::text, now()) - make_interval(mins => %(m)s)
                               ORDER BY record_id
                               LIMIT 50;""", {"m": STALE_MINUTES})
        cur.execute(query=query)
        rows = cur.fetchall()
    for r in rows:
        try:
            done = _finish(r["project_id"], r["record_id"], r["file_key"], r["upload_id"], r["parts"], "interrupted")
            logger.info(f"pg_assist_records: stale record {r['record_id']} {'completed as interrupted' if done else 'aborted'}")
        except Exception as e:
            logger.error(f"pg_assist_records: stale record {r['record_id']} {type(e).__name__} {str(e)[:160]}")


async def pg_close_stale_uploads_cron() -> None:
    await run_in_threadpool(_close_stale_uploads)


# app.py 启动时与官方定时任务一起注册
cron_jobs = [
    {"func": pg_close_stale_uploads_cron, "trigger": IntervalTrigger(minutes=10),
     "misfire_grace_time": 60 * 10, "max_instances": 1},
]
# end
