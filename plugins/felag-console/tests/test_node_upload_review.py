import base64, io, tarfile, pytest
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

def _seed_skill(conn, uid="u_ops", scope="dept:ops", name="deploy"):
    out = _run(uid, N.handle_skill_create,
               {"name": name, "scope_ref": scope, "version": "1.0.0", "content_b64": _pkg_b64(name)}, conn)
    return out["skill_id"], out["version_id"]

def test_upload_version_ok(conn):
    sid, _ = _seed_skill(conn)
    out = _run("u_ops", N.handle_skill_upload_version,
               {"skill_id": sid, "version": "2.0.0", "content_b64": _pkg_b64()}, conn)
    assert out["version_id"]
    assert store.get_version(conn, out["version_id"])["review_status"] == "pending"

def test_upload_version_denied_other_dept(conn):
    sid, _ = _seed_skill(conn, "u_ops", "dept:ops")
    # u_impl does not manage dept:ops skill; even if passing a manageable scope, it is rejected via skill_id lookup
    with pytest.raises(N.NodeError):
        _run("u_impl", N.handle_skill_upload_version,
             {"skill_id": sid, "version": "2.0.0", "content_b64": _pkg_b64(), "scope_ref": "dept:impl"}, conn)

def test_review_approve_publishes_and_sets_current(conn):
    sid, vid = _seed_skill(conn)
    out = _run("u_ops", N.handle_skill_review, {"version_id": vid, "action": "approve"}, conn)
    assert out["review_status"] == "published" and out["self_review"] is True
    assert store.get_skill(conn, sid)["current_version_id"] == vid

def test_review_double_approve_409(conn):
    sid, vid = _seed_skill(conn)
    _run("u_ops", N.handle_skill_review, {"version_id": vid, "action": "approve"}, conn)
    with pytest.raises(N.NodeError, match="已处理|409|pending"):
        _run("u_ops", N.handle_skill_review, {"version_id": vid, "action": "approve"}, conn)

def test_review_idor_other_dept_denied(conn):
    sid, vid = _seed_skill(conn, "u_ops", "dept:ops")
    with pytest.raises(N.NodeError):
        _run("u_impl", N.handle_skill_review, {"version_id": vid, "action": "approve"}, conn)

# ── 新流程：上传只暂存未压缩 tar（sha 空）、审核通过才打包成 tar.gz + 落 sha ──
def test_create_stages_uncompressed_tar_without_sha(conn):
    sid, vid = _seed_skill(conn)
    raw = store.get_version_content(conn, vid)
    assert raw[:2] != b"\x1f\x8b"                       # 暂存是未压缩 tar，不是 gzip
    assert store.get_version(conn, vid)["sha256"] == ""  # 未打包 → sha 留空

def test_version_files_lists_skill_md_text(conn):
    sid, vid = _seed_skill(conn)
    out = _run("u_ops", N.handle_version_files, {"version_id": vid}, conn)
    md = next(f for f in out["files"] if f["path"] == "deploy/SKILL.md")
    assert md["is_text"] and md["text"] == "# hi"

def test_approve_packages_gzip_and_lands_sha(conn):
    import io, tarfile
    sid, vid = _seed_skill(conn)
    _run("u_ops", N.handle_skill_review, {"version_id": vid, "action": "approve"}, conn)
    raw = store.get_version_content(conn, vid)
    assert raw[:2] == b"\x1f\x8b"                       # 审核通过后才 gzip 打包
    assert store.get_version(conn, vid)["sha256"]       # sha 已落
    tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz").close()  # 确是合法 tar.gz

def test_version_files_after_publish_autodetect(conn):
    sid, vid = _seed_skill(conn)
    _run("u_ops", N.handle_skill_review, {"version_id": vid, "action": "approve"}, conn)
    out = _run("u_ops", N.handle_version_files, {"version_id": vid}, conn)  # tar.gz 也能读（自动识别）
    assert any(f["path"] == "deploy/SKILL.md" for f in out["files"])

def test_reject_does_not_package(conn):
    sid, vid = _seed_skill(conn)
    _run("u_ops", N.handle_skill_review, {"version_id": vid, "action": "reject"}, conn)
    raw = store.get_version_content(conn, vid)
    assert raw[:2] != b"\x1f\x8b"                       # 驳回不打包，仍是暂存 tar
    assert store.get_version(conn, vid)["sha256"] == ""