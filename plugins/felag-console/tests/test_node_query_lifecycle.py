import base64, io, json, tarfile, pytest
from _lib.orgprovider import StubOrgProvider
from _lib import nodes_impl as N, store

def _pkg_b64(name="deploy"):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        d = tarfile.TarInfo(name + "/"); d.type = tarfile.DIRTYPE; tf.addfile(d)
        f = tarfile.TarInfo(name + "/SKILL.md"); data = b"# hi"; f.size = len(data); tf.addfile(f, io.BytesIO(data))
    return base64.b64encode(buf.getvalue()).decode()

def _run(uid, fn, params, conn):
    p = StubOrgProvider(uid); return fn(params, conn, p, p.get_actor({}))

def _seed(conn, uid, scope, name):
    return _run(uid, N.handle_skill_create,
                {"name": name, "scope_ref": scope, "version": "1.0.0", "content_b64": _pkg_b64(name)}, conn)

def test_skill_list_scope_isolation(conn):
    _seed(conn, "u_ops", "dept:ops", "a")
    _seed(conn, "u_impl", "dept:impl", "b")
    ops = {s["name"] for s in _run("u_ops", N.handle_skill_list, {}, conn)["skills"]}
    impl = {s["name"] for s in _run("u_impl", N.handle_skill_list, {}, conn)["skills"]}
    assert ops == {"a"} and impl == {"b"}

def test_skill_list_root_dept_lists_all(conn):
    _seed(conn, "u_ops", "dept:ops", "a")
    _seed(conn, "u_impl", "dept:impl", "b")
    # u_root 坐公司根部门 → 子树=全树 → 列全部（无 is_super 短路，纯组织）
    allnames = {s["name"] for s in _run("u_root", N.handle_skill_list, {}, conn)["skills"]}
    assert allnames == {"a", "b"}

def test_skill_list_subtree_expansion(conn):
    # skill 挂在职位 pos:ops-eng（dept:ops 子树），u_ops 坐 dept:ops → 应列出
    _run("u_root", N.handle_skill_create,
         {"name": "c", "scope_ref": "pos:ops-eng", "version": "1.0.0", "content_b64": _pkg_b64("c")}, conn)
    names = {s["name"] for s in _run("u_ops", N.handle_skill_list, {}, conn)["skills"]}
    assert "c" in names

def test_detail_idor_denied(conn):
    out = _seed(conn, "u_ops", "dept:ops", "a")
    with pytest.raises(N.NodeError):
        _run("u_impl", N.handle_skill_detail, {"skill_id": out["skill_id"]}, conn)

def test_deprecate(conn):
    out = _seed(conn, "u_ops", "dept:ops", "a")
    r = _run("u_ops", N.handle_skill_deprecate, {"skill_id": out["skill_id"]}, conn)
    assert r["status"] == "deprecated"
    assert store.get_skill(conn, out["skill_id"])["status"] == "deprecated"

def test_version_delete_pending_ok(conn):
    out = _seed(conn, "u_ops", "dept:ops", "a")
    r = _run("u_ops", N.handle_version_delete, {"version_id": out["version_id"]}, conn)
    assert r["deleted"] is True

def test_audit_list_scope(conn):
    _seed(conn, "u_ops", "dept:ops", "a")
    _seed(conn, "u_impl", "dept:impl", "b")
    ops_audit = _run("u_ops", N.handle_audit_list, {}, conn)["audit"]
    assert all(a["scope_ref"] in {"dept:ops", "pos:ops-eng", "pos:ops-lead"} for a in ops_audit)

def test_detail_and_audit_outputs_json_serializable(conn):
    # 版本行 created_at/published_at、审计行 ts 是 TIMESTAMPTZ→datetime，节点 emit 前必须已 isoformat，
    # 否则真机 json.dumps 抛 "Object of type datetime is not JSON serializable"（真机点详情崩过）。
    out = _seed(conn, "u_ops", "dept:ops", "a")
    detail = _run("u_ops", N.handle_skill_detail, {"skill_id": out["skill_id"]}, conn)
    json.dumps(detail)  # 不抛即通过
    assert isinstance(detail["versions"][0]["created_at"], str)
    audit = _run("u_ops", N.handle_audit_list, {}, conn)
    json.dumps(audit)
    assert isinstance(audit["audit"][0]["ts"], str)
