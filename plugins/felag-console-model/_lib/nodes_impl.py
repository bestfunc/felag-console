"""节点纯逻辑(与 runtime 解耦,便于单测注入 conn / provider / server 桩)。

🔒 贯穿本文件的一条规矩:**上游 LLM key 只过路,不留痕**。
它从 params 直接进 server.upsert_model,既不写库、也不进审计 detail、也不回显给 UI。
审计里关于 key 只记一个形态串(见 _key_state),那是可以安全落库的描述,不含任何 key 字符。
"""
from __future__ import annotations

from _lib import server, store


class NodeError(Exception):
    pass


def _require_superadmin(actor):
    """模型与上游密钥是租户级资产,直接决定 LLM 账单与可用性 —— 只给超管。
    identity 缺失(cron / API Key / 匿名)时 provider 给出 is_superadmin=False → fail-closed。"""
    if not getattr(actor, "is_superadmin", False):
        raise NodeError("仅超管可管理模型与密钥")


def _conn_cfg(conn):
    """连接参数:地址三级兜底、令牌由 felag-server 自举写库(见 store)。运维零配置。"""
    return store.resolve_server_base(conn), store.resolve_token(conn)


def _key_state(api_key: str) -> str:
    """把 key 压成可安全落审计的一句话 —— 只描述形态,不含任何 key 字符。"""
    if not api_key:
        return "未改动"
    if api_key.startswith("os.environ/"):
        return "引用环境变量 " + api_key[len("os.environ/"):]
    return "已更新为新的明文密钥"


def handle_model_list(params, conn, provider, actor) -> dict:
    """列网关当前的模型 + 本插件的连接配置视图。清单由 felag-server 脱敏后给出,不含 key 值。"""
    _require_superadmin(actor)
    base, token = _conn_cfg(conn)
    cfg = store.config_view(conn)
    cfg["resolved_server_base"] = base  # 让 UI 能显示"实际在连哪",排障时不用猜
    if not token:
        # 令牌本该由 felag-server 自举写库,取不到 = 它还没跑到这一步,而不是运维漏配了。
        # 给出可执行的诊断,而不是让人去填一个他不该知道的值。
        return {"models": [], "config": cfg, "configured": False,
                "hint": "服务令牌尚未就绪。它由 felag-server 自动写入本插件的配置表 —— "
                        "请确认 felag-server 已升级到 v0.0.27+ 且能连上平台库;"
                        "本插件刚装好时,等它下一轮自举(约 30 秒)后刷新即可。"}
    try:
        models = server.list_models(base, token)
    except server.ServerError as e:
        raise NodeError(str(e)) from e
    return {"models": models, "config": cfg, "configured": True}


def handle_model_upsert(params, conn, provider, actor) -> dict:
    """新增或更新一个模型。api_key 留空 = 保留网关上已有的 key(不覆盖)。"""
    _require_superadmin(actor)
    model_name = (params.get("model_name") or "").strip()
    upstream = (params.get("upstream") or "").strip()
    api_key = (params.get("api_key") or "").strip()
    api_base = (params.get("api_base") or "").strip()
    if not model_name:
        raise NodeError("模型名必填(客户端发起请求时用的就是它)")
    if not upstream:
        raise NodeError("上游模型必填,形如 deepseek/deepseek-v4-pro")

    base, token = _conn_cfg(conn)
    try:
        server.upsert_model(base, token, model_name, upstream, api_key, api_base)
    except server.ServerError as e:
        raise NodeError(str(e)) from e

    store.add_audit(conn, actor.user_id, "model.upsert", model_name,
                    {"upstream": upstream, "api_base": api_base, "key": _key_state(api_key)})
    conn.commit()
    return {"ok": True, "model_name": model_name}


def handle_model_delete(params, conn, provider, actor) -> dict:
    """删除一个模型(按网关侧 id)。yaml 里定义的模型网关会拒删,错误原样透出。"""
    _require_superadmin(actor)
    model_id = (params.get("model_id") or "").strip()
    model_name = (params.get("model_name") or "").strip()  # 仅用于审计可读性
    if not model_id:
        raise NodeError("模型 id 必填")

    base, token = _conn_cfg(conn)
    try:
        server.delete_model(base, token, model_id)
    except server.ServerError as e:
        raise NodeError(str(e)) from e

    store.add_audit(conn, actor.user_id, "model.delete", model_name or model_id, {"id": model_id})
    conn.commit()
    return {"ok": True, "id": model_id}


def handle_model_set_config(params, conn, provider, actor) -> dict:
    """写连接配置(felag-server 基址 + 共享服务令牌)。键名白名单限定,防越权写任意 KV。
    值留空 = 不改动该项(便于只改地址不重填令牌)。"""
    _require_superadmin(actor)
    cfg = params.get("config") or {}
    written = []
    for k, v in cfg.items():
        if k not in store.CONFIG_KEYS:
            raise NodeError(f"非法配置键: {k}")
        if (v or "").strip():
            store.set_config(conn, k, v.strip())
            written.append(k)
    store.add_audit(conn, actor.user_id, "model.set_config", "connection", {"keys": written})  # 只记键名
    conn.commit()
    return {"written": written, "config": store.config_view(conn)}
