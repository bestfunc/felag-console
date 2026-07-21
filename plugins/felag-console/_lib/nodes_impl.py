"""所有节点的业务逻辑纯函数。run.py 仅薄壳调用。每个 handle 接收
(params, conn, provider, actor)，写操作在调用方事务内、本函数内落 audit。"""
from __future__ import annotations
import base64
import gzip
import hashlib
import psycopg2
from _lib import store
from _lib.pkgvalidate import validate_package, PackageError
from _lib.pkgread import list_files

class NodeError(ValueError):
    pass

def _decode_pkg(params):
    b64 = params.get("content_b64") or ""
    try:
        return base64.b64decode(b64, validate=True)
    except Exception as e:
        raise NodeError(f"content_b64 解码失败：{e}") from e

def _to_tar(raw: bytes) -> bytes:
    """暂存统一存未压缩 tar：上传的若已是 gzip（旧流程/兼容）先解开，审核通过时再打包。"""
    if raw[:2] == b"\x1f\x8b":
        try:
            return gzip.decompress(raw)
        except OSError as e:
            raise NodeError(f"gzip 解压失败：{e}") from e
    return raw

# ---- actor_context ----
def handle_actor_context(params, conn, provider, actor) -> dict:
    scopes = provider.list_manageable_scopes(actor)
    return {
        "actor": {"user_id": actor.user_id, "name": actor.name, "dept_ref": actor.dept_ref},
        "manageable_scopes": [
            {"scope_ref": s.scope_ref, "label": s.label, "parent_ref": s.parent_ref} for s in scopes
        ],
    }

# ---- skill_create ----
def handle_skill_create(params, conn, provider, actor) -> dict:
    name = (params.get("name") or "").strip()
    scope_ref = params.get("scope_ref") or ""
    version = (params.get("version") or "").strip()
    if not (name and scope_ref and version):
        raise NodeError("name / scope_ref / version 必填")
    if not provider.can_manage_scope(actor, scope_ref):  # 建：唯一信任 params.scope_ref 的节点（反查纪律例外）
        raise NodeError("无权在该作用域建 skill")
    tar = _to_tar(_decode_pkg(params))
    try:
        validate_package(tar, name)
    except PackageError as e:
        raise NodeError(str(e)) from e
    try:
        skill_id = store.create_skill(conn, name, scope_ref, actor.user_id)
    except psycopg2.errors.UniqueViolation as e:
        conn.rollback()
        raise NodeError(f"skill 名 {name!r} 已存在（409）") from e
    # 暂存未压缩 tar、pending，未打包 → sha 留空，审核通过时才落最终包 sha
    version_id = store.add_version(conn, skill_id, version, tar, "", actor.user_id)
    store.add_audit(conn, actor.user_id, scope_ref, "skill.create", f"skill:{skill_id}",
                    {"version": version})
    conn.commit()
    return {"skill_id": skill_id, "version_id": version_id}

# ---- 反查 skill 并校验可管（反查纪律：scope_ref 一律来自 DB） ----
def _load_manageable_skill(conn, provider, actor, skill_id):
    skill = store.get_skill(conn, skill_id)
    if not skill or skill.get("deleted_at") is not None:
        raise NodeError("skill 不存在或无权访问")  # 不暴露存在性
    if not provider.can_manage_scope(actor, skill["scope_ref"]):
        raise NodeError("skill 不存在或无权访问")
    return skill

# ---- skill_upload_version ----
def handle_skill_upload_version(params, conn, provider, actor) -> dict:
    skill_id = params.get("skill_id")
    version = (params.get("version") or "").strip()
    if not (skill_id and version):
        raise NodeError("skill_id / version 必填")
    skill = _load_manageable_skill(conn, provider, actor, skill_id)
    tar = _to_tar(_decode_pkg(params))
    try:
        validate_package(tar, skill["name"])
    except PackageError as e:
        raise NodeError(str(e)) from e
    try:
        version_id = store.add_version(conn, skill_id, version, tar, "", actor.user_id)
    except psycopg2.errors.UniqueViolation as e:
        conn.rollback()
        raise NodeError(f"版本 {version!r} 已存在（409）") from e
    store.add_audit(conn, actor.user_id, skill["scope_ref"], "version.upload",
                    f"version:{version_id}", {"skill_id": skill_id, "version": version})
    conn.commit()
    return {"version_id": version_id}

# ---- skill_review ----
def handle_skill_review(params, conn, provider, actor) -> dict:
    version_id = params.get("version_id")
    action = params.get("action")
    if action not in ("approve", "reject"):
        raise NodeError("action 必须是 approve / reject")
    ver = store.get_version(conn, version_id)
    if not ver:
        raise NodeError("版本不存在或无权访问")
    skill = _load_manageable_skill(conn, provider, actor, ver["skill_id"])
    self_review = (ver["uploaded_by"] == actor.user_id)
    ok = store.review_version(conn, version_id, approve=(action == "approve"),
                              reviewer=actor.user_id, self_review=self_review)
    if not ok:
        conn.rollback()
        raise NodeError("版本非 pending（已处理 / 409）")
    detail = {"action": action, "self_review": self_review}
    if action == "approve":
        # 审核通过才打包：暂存的未压缩 tar → gzip 成分发用 tar.gz，落最终 sha（旧流程已是 gz 则直接用）
        raw = store.get_version_content(conn, version_id)
        gz = raw if raw[:2] == b"\x1f\x8b" else gzip.compress(raw, mtime=0)
        sha = hashlib.sha256(gz).hexdigest()
        store.finalize_package(conn, version_id, gz, sha)
        store.set_current_version(conn, skill["id"], version_id)
        detail["sha256"] = sha
    store.add_audit(conn, actor.user_id, skill["scope_ref"], "version.review", f"version:{version_id}", detail)
    conn.commit()
    return {"review_status": "published" if action == "approve" else "rejected",
            "self_review": self_review}

def _pending_count(conn, skill_id):
    with conn.cursor() as cur:
        cur.execute(f"SELECT count(*) FROM {store.P}versions WHERE skill_id=%s AND review_status='pending'",
                    (skill_id,))
        return cur.fetchone()[0]

# ---- skill_list ----
def handle_skill_list(params, conn, provider, actor) -> dict:
    rows = store.list_skills_by_scopes(conn, provider.manageable_scope_refs(actor))
    skills = [{
        "id": r["id"], "name": r["name"], "scope_ref": r["scope_ref"], "status": r["status"],
        "current_version_id": r["current_version_id"], "pending_count": _pending_count(conn, r["id"]),
    } for r in rows]
    return {"skills": skills}

# ---- skill_detail ----
def handle_skill_detail(params, conn, provider, actor) -> dict:
    skill = _load_manageable_skill(conn, provider, actor, params.get("skill_id"))
    versions = store.list_versions(conn, skill["id"])
    return {"skill": {k: skill[k] for k in ("id", "name", "scope_ref", "status", "current_version_id")},
            "versions": versions}

# ---- version_files（看某版本包里的文件；文本内联，二进制仅标记）----
def handle_version_files(params, conn, provider, actor) -> dict:
    ver = store.get_version(conn, params.get("version_id"))
    if not ver:
        raise NodeError("版本不存在或无权访问")
    _load_manageable_skill(conn, provider, actor, ver["skill_id"])  # 反查授权
    raw = store.get_version_content(conn, ver["id"])
    if raw is None:
        raise NodeError("版本内容缺失")
    return {"files": list_files(raw)}

# ---- skill_deprecate ----
def handle_skill_deprecate(params, conn, provider, actor) -> dict:
    skill = _load_manageable_skill(conn, provider, actor, params.get("skill_id"))
    store.set_status(conn, skill["id"], "deprecated")
    store.add_audit(conn, actor.user_id, skill["scope_ref"], "skill.deprecate", f"skill:{skill['id']}", {})
    conn.commit()
    return {"status": "deprecated"}

# ---- version_delete ----
def handle_version_delete(params, conn, provider, actor) -> dict:
    ver = store.get_version(conn, params.get("version_id"))
    if not ver:
        raise NodeError("版本不存在或无权访问")
    skill = _load_manageable_skill(conn, provider, actor, ver["skill_id"])
    if not store.delete_version(conn, ver["id"]):
        conn.rollback()
        raise NodeError("仅 pending / rejected 版本可删")
    store.add_audit(conn, actor.user_id, skill["scope_ref"], "version.delete", f"version:{ver['id']}", {})
    conn.commit()
    return {"deleted": True}

# ---- upload_review_list（client 用户上传的私有 skill 待审队列）----
def handle_upload_review_list(params, conn, provider, actor) -> dict:
    rows = store.list_pending_uploads(conn, provider.manageable_scope_refs(actor))
    return {"uploads": rows}

# ---- upload_files（看某待审上传件包里的文件；反查授权：上传者部门须可管）----
def handle_upload_files(params, conn, provider, actor) -> dict:
    up = store.get_upload(conn, params.get("upload_id"))
    if not up:
        raise NodeError("上传不存在或无权访问")
    if up["owner_dept_ref"] and not provider.can_manage_scope(actor, up["owner_dept_ref"]):
        raise NodeError("上传不存在或无权访问")  # 不暴露存在性
    raw = store.get_upload_content(conn, up["id"])
    if raw is None:
        raise NodeError("上传内容缺失")
    return {"files": list_files(raw), "name": up["name"], "version": up["version"]}

# ---- upload_review（审核上传件：approve→选作用域发布进治理表 / reject）----
def handle_upload_review(params, conn, provider, actor) -> dict:
    upload_id = params.get("upload_id")
    action = params.get("action")
    if action not in ("approve", "reject"):
        raise NodeError("action 必须是 approve / reject")
    up = store.get_upload(conn, upload_id)
    if not up or up["status"] != "pending":
        raise NodeError("上传不存在或已处理")
    # 反查授权：上传者部门须在可管范围内(可见性门；owner_dept_ref 为空的件谁都管不了 → fail-closed)
    if not up["owner_dept_ref"] or not provider.can_manage_scope(actor, up["owner_dept_ref"]):
        raise NodeError("上传不存在或无权访问")

    if action == "reject":
        reason = (params.get("reject_reason") or "").strip() or None
        if not store.mark_upload_reviewed(conn, upload_id, "rejected", actor.user_id, reason, None):
            conn.rollback()
            raise NodeError("上传非 pending（已处理 / 409）")
        store.add_audit(conn, actor.user_id, up["owner_dept_ref"], "upload.reject",
                        f"upload:{upload_id}", {"reason": reason})
        conn.commit()
        return {"status": "rejected"}

    # approve：必须选作用域(部门 or 岗位，二选一)且可管
    scope_ref = params.get("scope_ref") or ""
    if not scope_ref:
        raise NodeError("发布需选择作用域（部门或岗位）")
    if not provider.can_manage_scope(actor, scope_ref):
        raise NodeError("无权在该作用域发布")
    tar = store.get_upload_content(conn, upload_id)
    if tar is None:
        raise NodeError("上传内容缺失")
    try:
        validate_package(tar, up["name"])  # 纵深防御：发布前再校验包结构
    except PackageError as e:
        raise NodeError(str(e)) from e

    # 反查同名 live skill：存在则复用(其作用域不变，追加新版本)；否则用所选 scope 新建。
    existing = store.get_active_skill_by_name(conn, up["name"])
    if existing:
        if not provider.can_manage_scope(actor, existing["scope_ref"]):
            raise NodeError(f"skill 名 {up['name']!r} 已被占用")  # 不暴露归属
        skill_id = existing["id"]
    else:
        skill_id = store.create_skill(conn, up["name"], scope_ref, actor.user_id)
    try:
        version_id = store.add_version(conn, skill_id, up["version"], tar, "", up["owner_username"])
    except psycopg2.errors.UniqueViolation as e:
        conn.rollback()
        raise NodeError(f"版本 {up['version']!r} 已存在（409）") from e
    # 打包分发用 tar.gz + 落最终 sha，发布并置当前版
    gz = gzip.compress(tar, mtime=0)
    sha = hashlib.sha256(gz).hexdigest()
    store.finalize_package(conn, version_id, gz, sha)
    store.publish_version(conn, version_id, actor.user_id)
    store.set_current_version(conn, skill_id, version_id)
    if not store.mark_upload_reviewed(conn, upload_id, "approved", actor.user_id, None, skill_id):
        conn.rollback()
        raise NodeError("上传非 pending（已处理 / 409）")
    store.add_audit(conn, actor.user_id, existing["scope_ref"] if existing else scope_ref,
                    "upload.approve", f"upload:{upload_id}",
                    {"skill_id": skill_id, "version_id": version_id, "version": up["version"],
                     "owner": up["owner_username"], "sha256": sha})
    conn.commit()
    return {"status": "approved", "skill_id": skill_id, "version_id": version_id, "sha256": sha}

# ---- audit_list ----
def handle_audit_list(params, conn, provider, actor) -> dict:
    rows = store.list_audit(conn, scope_refs=provider.manageable_scope_refs(actor),
                            skill_id=params.get("skill_id"))
    return {"audit": rows}
