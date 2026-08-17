"""felag-server 对接:模型与密钥治理(共享服务令牌鉴权)。纯 stdlib urllib(与同仓 app-release/server.py 同风格)。

🔒 M5:上游 LLM key 在这里只是**过路**——从 UI 表单经本模块 POST 给 felag-server,
再由它转给网关 LiteLLM 落库。本插件不存 key、不回读 key、不把 key 写进审计或异常信息。
路径:插件 worker → felag-server 均在内网,令牌走平台库 config 通道下发。
"""
from __future__ import annotations
import json
import urllib.error
import urllib.request

_TIMEOUT = 30


class ServerError(Exception):
    pass


def _require(base_url: str, token: str):
    if not base_url:
        raise ServerError("felag_server_base 未配置(先在本页「连接配置」里填)")
    if not token:
        raise ServerError("felag_model_admin_token 未配置(先在本页「连接配置」里填)")


def _call(base_url: str, token: str, path: str, payload=None, method="GET"):
    _require(base_url, token)
    url = base_url.rstrip("/") + path
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
        detail = _err_body(e)
        if e.code == 404:
            raise ServerError(
                "felag-server 未开启模型治理端点(需在其 .env 配 FELAG_MODEL_ADMIN_TOKEN 后重启)"
            ) from e
        if e.code == 401:
            raise ServerError("服务令牌不匹配(本页配置的令牌需与 felag-server 的 FELAG_MODEL_ADMIN_TOKEN 同值)") from e
        raise ServerError(f"felag-server 返回 HTTP {e.code}: {detail}") from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise ServerError(f"连接 felag-server 失败: {e}") from e


def list_models(base_url: str, token: str) -> dict:
    """GET /admin/models。回整个响应:models(已脱敏,无 key 值)+ roles(各角色使用中的模型)。

    ⚠️ 早先这里只取 models、把 roles 丢了,界面上「使用中的模型」于是永远显示"未选择"——
    切换其实成功了,只是读回来的那一半没接上。返回整体而不是挑字段,免得再漏。
    """
    return _call(base_url, token, "/admin/models") or {}


def upsert_model(base_url: str, token: str, model_name: str, upstream: str,
                 api_key: str = "", api_base: str = "") -> dict:
    """POST /admin/models。api_key 留空 = 不改动上游已有的 key。"""
    payload = {"modelName": model_name, "upstream": upstream}
    if api_key:
        payload["apiKey"] = api_key
    if api_base:
        payload["apiBase"] = api_base
    return _call(base_url, token, "/admin/models", payload, method="POST")


def set_role(base_url: str, token: str, role: str, model_name: str) -> dict:
    """POST /admin/models/role —— 一键切换某角色(基准对话 / 图片识别)的「使用中」模型。"""
    return _call(base_url, token, "/admin/models/role",
                 {"role": role, "modelName": model_name}, method="POST")


def test_model(base_url: str, token: str, model_name: str) -> dict:
    """POST /admin/models/test —— 实调一次,回答"这个模型现在能不能用"。
    这是唯一可靠的可用性来源:网关对任何模型都不回传密钥字段,光看配置只能猜。"""
    return _call(base_url, token, "/admin/models/test", {"modelName": model_name}, method="POST")


def delete_model(base_url: str, token: str, model_id: str) -> dict:
    """POST /admin/models/delete。只能删经本页面写进网关库的模型(yaml 里定义的网关会拒)。"""
    return _call(base_url, token, "/admin/models/delete", {"id": model_id}, method="POST")


def _err_body(e: "urllib.error.HTTPError") -> str:
    try:
        return e.read().decode("utf-8", "replace")[:200]
    except Exception:
        return ""
