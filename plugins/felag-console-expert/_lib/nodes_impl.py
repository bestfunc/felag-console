"""节点的纯逻辑实现。

刻意把逻辑从 run.py 里抽出来:run.py 只做「连库 → 调这里 → emit」,
而这里不碰 Runtime、不碰环境变量,可以用假 conn / 假 provider 直接跑 pytest。
插件在平台上没法本地端到端跑,能本地验的那部分就必须留在可验的位置。
"""
from __future__ import annotations

from . import expertmd, store


class NodeError(ValueError):
    """节点级业务错误:由 run.py 转成 rt.emit_error,用户能看到这句话。"""


def _require_scope(provider, actor, scope_ref: str):
    if not scope_ref:
        raise NodeError("请选择发布作用域(部门或岗位)")
    if not provider.can_manage_scope(actor, scope_ref):
        raise NodeError(f"你没有该作用域的管理权限:{scope_ref}")


def _load_manageable(conn, provider, actor, expert_id):
    if not expert_id:
        raise NodeError("缺 expert_id")
    row = store.get(conn, int(expert_id))
    if not row:
        raise NodeError("专家不存在或已删除")
    # 反查授权:能不能动这条,取决于它挂在哪个作用域,而不是调用方声称的作用域
    if not provider.can_manage_scope(actor, row["scope_ref"]):
        raise NodeError("你没有该专家所属作用域的管理权限")
    return row


# ---- expert_list ----
def handle_expert_list(params, conn, provider, actor) -> dict:
    rows = store.list_by_scopes(conn, provider.manageable_scope_refs(actor), provider.can_manage_orphans(actor))
    return {"experts": rows}


# ---- expert_detail(带正文)----
def handle_expert_detail(params, conn, provider, actor) -> dict:
    row = _load_manageable(conn, provider, actor, params.get("expert_id"))
    meta, body = expertmd.parse(row["body"])
    return {"expert": row, "meta": meta, "body": body}


# ---- expert_save(新建 / 改)----
def handle_expert_save(params, conn, provider, actor) -> dict:
    raw = (params.get("body") or "").strip()
    scope_ref = (params.get("scope_ref") or "").strip()
    _require_scope(provider, actor, scope_ref)
    if not raw:
        raise NodeError("请提供 EXPERT.md 内容")

    meta, body = expertmd.parse(raw)
    problems = expertmd.validate(meta, body)
    if problems:
        raise NodeError("EXPERT.md 校验未过:" + "；".join(problems))

    name = meta["name"]
    sha = expertmd.sha256_of(raw)
    expert_id = params.get("expert_id")

    if expert_id:
        row = _load_manageable(conn, provider, actor, expert_id)
        # 改名等于换一个 client 落盘目录,旧目录不会被清掉 —— 直接禁掉,要改名就新建
        if row["name"] != name:
            raise NodeError(f"不允许改名(原 {row['name']} → 新 {name});要换名字请新建一个专家")
        store.update(conn, row["id"], scope_ref=scope_ref, display_name=meta["displayName"],
                     profession=meta.get("profession", ""), description=meta.get("description", ""),
                     version=meta["version"], avatar=meta.get("avatar", ""), body=raw, sha256=sha)
        store.audit(conn, actor.id, scope_ref, "expert_update", name, {"version": meta["version"]})
        conn.commit()
        return {"id": row["id"], "name": name, "status": "pending"}

    if store.get_by_name(conn, name):
        raise NodeError(f"专家 {name} 已存在(同名只允许一条);要改它请打开详情编辑")
    new_id = store.insert(conn, name=name, scope_ref=scope_ref, display_name=meta["displayName"],
                          profession=meta.get("profession", ""), description=meta.get("description", ""),
                          version=meta["version"], avatar=meta.get("avatar", ""),
                          body=raw, sha256=sha, created_by=actor.id)
    store.audit(conn, actor.id, scope_ref, "expert_create", name, {"version": meta["version"]})
    conn.commit()
    return {"id": new_id, "name": name, "status": "pending"}


# ---- expert_review(通过发布 / 驳回)----
def handle_expert_review(params, conn, provider, actor) -> dict:
    row = _load_manageable(conn, provider, actor, params.get("expert_id"))
    approve = bool(params.get("approve"))
    if row["status"] == "published" and approve:
        raise NodeError("该专家已是发布状态")
    status = "published" if approve else "rejected"
    reason = (params.get("reason") or "").strip() or None
    store.set_status(conn, row["id"], status, actor.id, reason)
    store.audit(conn, actor.id, row["scope_ref"], f"expert_{status}", row["name"], {"reason": reason})
    conn.commit()
    return {"id": row["id"], "status": status}


# ---- expert_deprecate(下架)----
def handle_expert_deprecate(params, conn, provider, actor) -> dict:
    row = _load_manageable(conn, provider, actor, params.get("expert_id"))
    store.set_status(conn, row["id"], "deprecated", actor.id, None)
    store.audit(conn, actor.id, row["scope_ref"], "expert_deprecate", row["name"], {})
    conn.commit()
    # 下架只停止**继续下发**,已装到客户端的那份不会被远程删除 —— 与 skill/插件腿同缺口,
    # 在这里说明白,免得管理员以为点一下就收回了。
    return {"id": row["id"], "status": "deprecated",
            "note": "已停止下发;已装到客户端的副本不会被远程删除"}


# ---- audit_list ----
def handle_audit_list(params, conn, provider, actor) -> dict:
    if not provider.can_manage_orphans(actor):
        raise NodeError("仅超管可查看审计流水")
    return {"audit": store.list_audit(conn, int(params.get("limit") or 100))}
