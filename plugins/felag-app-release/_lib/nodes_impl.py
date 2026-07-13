"""所有节点的业务逻辑纯函数。run.py 仅薄壳调用。每个 handle 接收
(params, conn, provider, actor),写操作在本函数内落 audit 并 commit(store 层不 commit,节点层收口事务)。

**客户端版本全局,仅超管可管理**(spec §6.1):每个 handle 先过 _require_super,非超管一律拒。
安装包字节不进平台库——上传经 felag-server 落它本地卷,平台库只存元数据。"""
import base64
import psycopg2
from _lib import store, server

_PLATFORMS = ("windows", "darwin")

class NodeError(Exception):
    pass

def _require_super(actor):
    if not getattr(actor, "is_superadmin", False):
        raise NodeError("仅超管可管理客户端版本")

def _cfg(conn):
    return store.get_config(conn, "felag_server_base"), store.get_config(conn, "felag_app_upload_token")

def handle_release_list(params, conn, provider, actor) -> dict:
    _require_super(actor)
    return {"releases": store.list_all(conn)}

def handle_release_upload(params, conn, provider, actor) -> dict:
    _require_super(actor)
    version = (params.get("version") or "").strip()
    platform = (params.get("platform") or "").strip()
    notes = (params.get("notes") or "").strip()
    if not version:
        raise NodeError("version 必填")
    if platform not in _PLATFORMS:
        raise NodeError(f"platform 必须是 {' / '.join(_PLATFORMS)}")
    b64 = params.get("content_b64") or ""
    try:
        data = base64.b64decode(b64, validate=True)
    except Exception as e:
        raise NodeError(f"content_b64 解码失败：{e}") from e
    if not data:
        raise NodeError("安装包为空")

    base_url, token = _cfg(conn)
    try:
        meta = server.upload(base_url, token, version, platform, notes, data)
    except server.ServerError as e:
        raise NodeError(str(e)) from e

    try:
        rid = store.insert_draft(conn, version, platform, notes,
                                 meta["filename"], meta["sha256"], meta.get("size", 0), actor.user_id)
    except psycopg2.errors.UniqueViolation as e:
        conn.rollback()
        raise NodeError(f"版本 {version}({platform})已存在,要重传请先删旧记录") from e
    store.add_audit(conn, actor.user_id, "release.upload", f"release:{rid}",
                    {"version": version, "platform": platform, "filename": meta["filename"], "size": meta.get("size", 0)})
    conn.commit()
    return {"id": rid, "filename": meta["filename"], "sha256": meta["sha256"], "size": meta.get("size", 0)}

def handle_release_publish(params, conn, provider, actor) -> dict:
    _require_super(actor)
    release_id = params.get("release_id")
    if not release_id:
        raise NodeError("release_id 必填")
    row = store.get(conn, release_id)
    if row is None:
        raise NodeError("发布记录不存在")
    if not store.set_current(conn, release_id, row["platform"]):
        conn.rollback()
        raise NodeError("发布记录不存在")
    store.add_audit(conn, actor.user_id, "release.publish", f"release:{release_id}",
                    {"version": row["version"], "platform": row["platform"]})
    conn.commit()
    return {"published": True, "platform": row["platform"], "version": row["version"]}

def handle_release_delete(params, conn, provider, actor) -> dict:
    _require_super(actor)
    release_id = params.get("release_id")
    if not release_id:
        raise NodeError("release_id 必填")
    row = store.get(conn, release_id)
    if row is None:
        raise NodeError("发布记录不存在")
    if row["is_current"]:
        raise NodeError("当前在线版本不可删,请先发布同平台其他版本再删")

    base_url, token = _cfg(conn)
    try:
        server.delete(base_url, token, row["filename"])
    except server.ServerError as e:
        raise NodeError(str(e)) from e

    if not store.delete(conn, release_id):
        conn.rollback()
        raise NodeError("发布记录已变(可能已被设为当前版),请刷新")
    store.add_audit(conn, actor.user_id, "release.delete", f"release:{release_id}",
                    {"version": row["version"], "platform": row["platform"], "filename": row["filename"]})
    conn.commit()
    return {"deleted": True}
