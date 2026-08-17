"""识图模型选择:经 felag-server 的 /vision/models · /vision/model。

为什么这条通道在「插件源管理」里也开一份 —— 官方插件 felag-vision 的"配置"里,
管理员唯一需要决定的事就是**用哪个模型看图**(上游密钥在网关侧,服务令牌由 server 自举,
两样都不用人填)。所以那颗按钮弹出的应该是一个模型下拉,而不是飞书那套 App ID/Secret 表单。

⚠️ 这不是第二个真相源:选中的值写的就是 role_vision,与「模型与密钥」页的「图片识别」
是同一个 KV,两边看到的永远一致。这里只是把它摆在管理员当下所在的页面上。

🔒 M5:本模块不碰任何 LLM key。felag_vision_token 只是敲 felag-server 门的服务令牌,
由 server 自举写进本插件的 config 表(见其 platform.EnsureVisionToken)。
"""
from __future__ import annotations
import json
import urllib.error
import urllib.request

from _lib import store

_TIMEOUT = 20

# 与 felag-console-model 同一个默认值:同在 daily-report_dr-net,容器名固定。
DEFAULT_SERVER_BASE = "http://felag-server:28080"


class VisionError(Exception):
    pass


def resolve_server_base(conn) -> str:
    """三级兜底,运维零配置:本插件 config → 模型治理插件配过的同一个 server → 容器名默认值。"""
    cfg = store.get_config(conn, ["felag_server_base"])
    if v := (cfg.get("felag_server_base") or "").strip():
        return v
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT v FROM plg_felagmodel_config WHERE k='felag_server_base'")
            r = cur.fetchone()
            if r and r[0]:
                return r[0]
    except Exception:
        # 模型治理插件没装 → 表不存在(42P01)。正常情况,不是错误;
        # 但异常已让本事务 aborted,必须回滚才能继续用这个连接。
        conn.rollback()
    return DEFAULT_SERVER_BASE


def _token(conn) -> str:
    return (store.get_config(conn, ["felag_vision_token"]).get("felag_vision_token") or "").strip()


def _call(conn, path: str, payload=None, method="GET"):
    token = _token(conn)
    if not token:
        raise VisionError(
            "服务令牌尚未就绪。它由 felag-server 自动写入本插件的配置表 —— "
            "请确认 felag-server 已升级到 v0.0.30+ 且能连上平台库;刚装好时等下一轮自举(约 30 秒)后刷新。")
    url = resolve_server_base(conn).rstrip("/") + path
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise VisionError("felag-server 未开启识图端点(需升级到 v0.0.30+)") from e
        if e.code == 401:
            raise VisionError("识图服务令牌不匹配(felag-server 侧可能已重新自举,刷新后重试)") from e
        raise VisionError(f"felag-server 返回 HTTP {e.code}") from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise VisionError(f"连接 felag-server 失败: {e}") from e


def list_models(conn) -> dict:
    """GET /vision/models → {"models": [...], "current": "..."}。"""
    return _call(conn, "/vision/models") or {}


def set_model(conn, model_name: str) -> dict:
    """POST /vision/model —— 写 role_vision,与「模型与密钥」页的「图片识别」同一个值。"""
    return _call(conn, "/vision/model", {"modelName": model_name}, method="POST")
