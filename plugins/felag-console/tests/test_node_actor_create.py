import base64, io, tarfile, pytest
from _lib.orgprovider import StubOrgProvider
from _lib import nodes_impl as N

def _pkg_b64(name="deploy"):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        d = tarfile.TarInfo(name + "/"); d.type = tarfile.DIRTYPE; tf.addfile(d)
        f = tarfile.TarInfo(name + "/SKILL.md"); data = b"# hi"; f.size = len(data); tf.addfile(f, io.BytesIO(data))
    return base64.b64encode(buf.getvalue()).decode()

def _run(uid, fn, params, conn):
    p = StubOrgProvider(uid); a = p.get_actor({})
    return fn(params, conn, p, a)

def test_actor_context_ops(conn):
    out = _run("u_ops", N.handle_actor_context, {}, conn)
    assert out["actor"]["user_id"] == "u_ops"
    assert {s["scope_ref"] for s in out["manageable_scopes"]} == {"dept:ops", "pos:ops-eng", "pos:ops-lead"}

def test_create_ok(conn):
    out = _run("u_ops", N.handle_skill_create,
               {"name": "deploy", "scope_ref": "dept:ops", "version": "1.0.0", "content_b64": _pkg_b64()}, conn)
    assert out["skill_id"] and out["version_id"]

def test_create_denied_out_of_scope(conn):
    with pytest.raises(N.NodeError):
        _run("u_ops", N.handle_skill_create,
             {"name": "x", "scope_ref": "dept:impl", "version": "1.0.0", "content_b64": _pkg_b64("x")}, conn)

def test_create_duplicate_name_409(conn):
    params = {"name": "deploy", "scope_ref": "dept:ops", "version": "1.0.0", "content_b64": _pkg_b64()}
    _run("u_ops", N.handle_skill_create, params, conn)
    with pytest.raises(N.NodeError, match="已存在|409"):
        _run("u_ops", N.handle_skill_create, params, conn)

def test_create_bad_package_rejected(conn):
    import base64 as b64
    bad = b64.b64encode(b"not a tarball").decode()
    with pytest.raises(N.NodeError):
        _run("u_ops", N.handle_skill_create,
             {"name": "deploy", "scope_ref": "dept:ops", "version": "1.0.0", "content_b64": bad}, conn)
