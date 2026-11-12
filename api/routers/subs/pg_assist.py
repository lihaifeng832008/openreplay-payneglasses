# add lee 2026.11.12 看屏通话视频开关（Lee 11-12 定：放 OpenReplay 侧，项目设置 Assist 标签统一开关，默认关）
# 1) 坐席端（登录后）读 / 改本项目的开关：GET/POST /{projectId}/pg/assist-settings
# 2) 客户端跟踪包按官方选项 callUITemplate 取通话小窗模板：GET /pg/assist/call-ui/{projectKey}（公开，只返回模板 HTML）
#    开关关 → 官方模板去掉“Start Video”按钮（#video-btn）；开 → 官方模板原样
# 开关存 public.projects.gdpr（jsonb）里的 pgAssistCallVideo 键：官方保存 GDPR 用 gdpr || 新值 合并，不会冲掉；不改表结构
import logging
import re
from pathlib import Path

from fastapi import Body, Depends, HTTPException, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

import schemas
from chalicelib.utils import pg_client
from or_dependencies import OR_context, OR_role
from routers.base import get_routers

logger = logging.getLogger(__name__)
public_app, app, app_apikey = get_routers()

SETTING_KEY = "pgAssistCallVideo"
# 官方模板原样（与 pg-tracker/assist/widget/index.html 字节一致，pg-tracker/build.mjs 打包时核对）
_TEMPLATE = (Path(__file__).resolve().parents[2] / "pg_assist" / "call-ui.html").read_text(encoding="utf-8")
# 官方模板里视频按钮从 <a id="video-btn"> 到其后的说明注释为止，整段去掉
_VIDEO_BTN = re.compile(r'[ \t]*<a href="#" id="video-btn".*?<!--Add class \.off to #video-btn when user stops video -->[ \t]*\r?\n?',
                        re.S)
_AUDIO_TEMPLATE, _n = _VIDEO_BTN.subn("", _TEMPLATE, count=1)
if _n != 1 or 'id="video-btn"' in _AUDIO_TEMPLATE:
    # 模板变了对不上：不返回会带出视频按钮的模板，关闭时改回 503，跟踪包退回官方备用小窗（备用小窗本来就没有视频按钮）
    logger.error("pg_assist: call-ui.html 里找不到视频按钮整段，关闭视频时将返回 503")
    _AUDIO_TEMPLATE = None
_PROJECT_KEY = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_NO_CACHE = {"Cache-Control": "no-store, no-cache"}


class PgAssistSettingsSchema(BaseModel):
    callVideo: bool = Field(...)


def _get_settings(project_id: int):
    with pg_client.PostgresClient() as cur:
        query = cur.mogrify(f"""SELECT COALESCE((gdpr ->> '{SETTING_KEY}')::boolean, FALSE) AS call_video
                                FROM public.projects
                                WHERE project_id = %(project_id)s
                                  AND deleted_at ISNULL;""",
                            {"project_id": project_id})
        cur.execute(query=query)
        row = cur.fetchone()
    if row is None:
        return None
    return {"projectId": project_id, "callVideo": row["call_video"]}


@app.get('/{projectId}/pg/assist-settings', tags=["projects", "pg-assist"])
def get_pg_assist_settings(projectId: int, context: schemas.CurrentContext = Depends(OR_context)):
    data = _get_settings(projectId)
    if data is None:
        return {"errors": ["project not found"]}
    return {"data": data}


@app.post('/{projectId}/pg/assist-settings', tags=["projects", "pg-assist"], dependencies=[OR_role("owner", "admin")])
def edit_pg_assist_settings(projectId: int, data: PgAssistSettingsSchema = Body(...),
                            context: schemas.CurrentContext = Depends(OR_context)):
    with pg_client.PostgresClient() as cur:
        query = cur.mogrify(f"""UPDATE public.projects
                                SET gdpr = COALESCE(gdpr, '{{}}'::jsonb) || jsonb_build_object('{SETTING_KEY}', %(call_video)s::boolean)
                                WHERE project_id = %(project_id)s
                                  AND deleted_at ISNULL
                                RETURNING project_id;""",
                            {"project_id": projectId, "call_video": data.callVideo})
        cur.execute(query=query)
        row = cur.fetchone()
    if row is None:
        return {"errors": ["project not found"]}
    logger.info(f"pg_assist: project {projectId} callVideo={data.callVideo} by user {context.user_id}")
    return {"data": _get_settings(projectId)}


@public_app.get('/pg/assist/call-ui/{projectKey}', tags=["pg-assist"], response_class=HTMLResponse)
def get_pg_assist_call_ui(projectKey: str):
    if not _PROJECT_KEY.match(projectKey):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    with pg_client.PostgresClient() as cur:
        query = cur.mogrify(f"""SELECT COALESCE((gdpr ->> '{SETTING_KEY}')::boolean, FALSE) AS call_video
                                FROM public.projects
                                WHERE project_key = %(project_key)s
                                  AND deleted_at ISNULL;""",
                            {"project_key": projectKey})
        cur.execute(query=query)
        row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    if row["call_video"]:
        return HTMLResponse(content=_TEMPLATE, headers=_NO_CACHE)
    if _AUDIO_TEMPLATE is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="call ui unavailable")
    return HTMLResponse(content=_AUDIO_TEMPLATE, headers=_NO_CACHE)
# end
