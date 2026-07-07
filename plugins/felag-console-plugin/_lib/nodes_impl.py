"""所有节点的业务逻辑纯函数。run.py 仅薄壳调用。每个 handle 接收
(params, conn, provider, actor)，写操作在本函数内落 audit 并 commit
（store 层不 commit，节点层收口事务）。"""
import psycopg2
from _lib import store, discover

class NodeError(Exception):
    pass

def handle_plugin_discover(params) -> dict:
    """探测 git 仓可选插件(纯拉取枚举,无 DB/scope 门)。仅作建源提示,插件名仍可手填。"""
    git_url = (params.get("git_url") or "").strip()
    if not git_url:
        raise NodeError("git_url 必填")
    try:
        plugins = discover.discover(git_url)
    except ValueError as e:      # 非 github / 无法解析 owner-repo / HTTP 非 200
        raise NodeError(str(e)) from e
    except Exception as e:       # 网络/解压等
        raise NodeError(f"探测失败: {e}") from e
    return {"plugins": plugins}

def handle_actor_context(params, conn, provider, actor) -> dict:
    scopes = provider.list_manageable_scopes(actor)
    return {
        "actor": {"user_id": actor.user_id, "name": actor.name, "dept_ref": actor.dept_ref},
        "manageable_scopes": [
            {"scope_ref": s.scope_ref, "label": s.label, "parent_ref": s.parent_ref} for s in scopes
        ],
    }

def handle_plugin_source_create(params, conn, provider, actor) -> dict:
    git_url = (params.get("git_url") or "").strip()
    plugin = (params.get("plugin") or "").strip()
    scope_ref = (params.get("scope_ref") or "").strip()
    if not (git_url and plugin and scope_ref):
        raise NodeError("git_url / plugin / scope_ref 必填")
    if not provider.can_manage_scope(actor, scope_ref):   # 建：唯一信任 params.scope_ref（反查该 scope）
        raise NodeError("无权在该作用域建插件源")
    try:
        sid = store.create_source(conn, git_url, plugin, scope_ref, actor.user_id)
    except psycopg2.errors.UniqueViolation as e:
        conn.rollback()
        raise NodeError(f"插件源 (git,plugin,scope) 已存在：{e}") from e
    store.add_audit(conn, actor.user_id, scope_ref, "source.create", f"source:{sid}",
                    {"git_url": git_url, "plugin": plugin})
    conn.commit()
    return {"id": sid}

def _load_owned(conn, provider, actor, source_id):
    row = store.get_source(conn, source_id)
    if row is None or not provider.can_manage_scope(actor, row["scope_ref"]):
        raise NodeError("插件源不存在或无权访问")   # 不暴露存在性
    return row

def handle_plugin_source_review(params, conn, provider, actor) -> dict:
    source_id = params.get("source_id")
    action = params.get("action")
    if action not in ("approve", "deprecate"):
        raise NodeError("action 必须是 approve / deprecate")
    row = _load_owned(conn, provider, actor, source_id)
    if action == "approve":
        ok = store.review_source(conn, source_id, actor.user_id)
    else:
        ok = store.deprecate_source(conn, source_id, actor.user_id)
    if not ok:
        conn.rollback()
        raise NodeError("插件源状态已变（非预期态 / 409），请刷新")
    store.add_audit(conn, actor.user_id, row["scope_ref"], f"source.{action}", f"source:{source_id}", {})
    conn.commit()
    return {"status": "approved" if action == "approve" else "deprecated"}

def handle_plugin_source_delete(params, conn, provider, actor) -> dict:
    source_id = params.get("source_id")
    row = _load_owned(conn, provider, actor, source_id)
    ok = store.delete_source(conn, source_id)
    if not ok:
        conn.rollback()
        raise NodeError("仅 draft / deprecated 插件源可删")
    store.add_audit(conn, actor.user_id, row["scope_ref"], "source.delete", f"source:{source_id}", {})
    conn.commit()
    return {"deleted": True}

def handle_plugin_source_list(params, conn, provider, actor) -> dict:
    status = params.get("status")
    rows = store.list_sources_by_scopes(conn, provider.manageable_scope_refs(actor), status=status)
    return {"sources": rows}

def handle_audit_list(params, conn, provider, actor) -> dict:
    scopes = provider.manageable_scope_refs(actor)
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT actor, scope_ref, action, target, detail, ts FROM {store.P}audit "
            f"WHERE scope_ref = ANY(%s) ORDER BY id DESC LIMIT 200", (list(scopes),))
        keys = ["actor", "scope_ref", "action", "target", "detail", "ts"]
        rows = [store._jsonify(dict(zip(keys, r))) for r in cur.fetchall()]  # ts datetime→isoformat
    return {"audit": rows}
