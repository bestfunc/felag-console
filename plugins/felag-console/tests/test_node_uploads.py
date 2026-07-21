import io, tarfile, pytest
from _lib.orgprovider import StubOrgProvider
from _lib import nodes_impl as N, store

# ── felag-server(Go)在生产写 uploads 行;单测里直接插一行模拟 client 上传 ──
def _tar(name="deploy", body=b"# hi"):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:") as tf:  # 未压缩 tar(暂存态)
        d = tarfile.TarInfo(name + "/"); d.type = tarfile.DIRTYPE; tf.addfile(d)
        f = tarfile.TarInfo(name + "/SKILL.md"); f.size = len(body); tf.addfile(f, io.BytesIO(body))
    return buf.getvalue()

def _seed_upload(conn, owner="user@x", dept="dept:ops", name="deploy", version="1.0.0"):
    tar = _tar(name)
    with conn.cursor() as cur:
        cur.execute(
            f"INSERT INTO {store.P}uploads(owner_username,owner_dept_ref,name,version,content,size_bytes,sha256,description)"
            f" VALUES(%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
            (owner, dept, name, version, store.psycopg2_bytea(tar), len(tar), "deadbeef", "hi"),
        )
        uid = cur.fetchone()[0]
    conn.commit()
    return uid

def _run(uid, fn, params, conn):
    p = StubOrgProvider(uid); return fn(params, conn, p, p.get_actor({}))

def test_list_shows_pending_in_scope(conn):
    _seed_upload(conn, dept="dept:ops")
    out = _run("u_ops", N.handle_upload_review_list, {}, conn)
    assert len(out["uploads"]) == 1 and out["uploads"][0]["name"] == "deploy"

def test_list_hides_other_dept(conn):
    _seed_upload(conn, dept="dept:ops")
    out = _run("u_impl", N.handle_upload_review_list, {}, conn)  # u_impl 管 dept:impl,看不到 dept:ops 的件
    assert out["uploads"] == []

def test_upload_files_preview(conn):
    up = _seed_upload(conn)
    out = _run("u_ops", N.handle_upload_files, {"upload_id": up}, conn)
    md = next(f for f in out["files"] if f["path"] == "deploy/SKILL.md")
    assert md["is_text"] and md["text"] == "# hi"

def test_approve_creates_published_skill(conn):
    up = _seed_upload(conn, name="deploy")
    out = _run("u_ops", N.handle_upload_review, {"upload_id": up, "action": "approve", "scope_ref": "dept:ops"}, conn)
    assert out["status"] == "approved" and out["skill_id"] and out["sha256"]
    v = store.get_version(conn, out["version_id"])
    assert v["review_status"] == "published"
    # 分发包是 tar.gz、当前版已置、上传件标 approved
    raw = store.get_version_content(conn, out["version_id"]); assert raw[:2] == b"\x1f\x8b"
    assert store.get_skill(conn, out["skill_id"])["current_version_id"] == out["version_id"]
    assert store.get_upload(conn, up)["status"] == "approved"

def test_approve_to_position_scope(conn):
    up = _seed_upload(conn)
    out = _run("u_ops", N.handle_upload_review, {"upload_id": up, "action": "approve", "scope_ref": "pos:ops-eng"}, conn)
    assert store.get_active_skill_by_name(conn, "deploy")["scope_ref"] == "pos:ops-eng"

def test_approve_requires_scope(conn):
    up = _seed_upload(conn)
    with pytest.raises(N.NodeError, match="作用域"):
        _run("u_ops", N.handle_upload_review, {"upload_id": up, "action": "approve"}, conn)

def test_approve_out_of_scope_denied(conn):
    up = _seed_upload(conn, dept="dept:ops")
    with pytest.raises(N.NodeError):  # u_impl 看不到该件
        _run("u_impl", N.handle_upload_review, {"upload_id": up, "action": "approve", "scope_ref": "dept:impl"}, conn)

def test_reject_marks_and_no_skill(conn):
    up = _seed_upload(conn)
    out = _run("u_ops", N.handle_upload_review, {"upload_id": up, "action": "reject", "reject_reason": "格式不合规"}, conn)
    assert out["status"] == "rejected"
    assert store.get_upload(conn, up)["status"] == "rejected"
    assert store.get_active_skill_by_name(conn, "deploy") is None

def test_double_review_409(conn):
    up = _seed_upload(conn)
    _run("u_ops", N.handle_upload_review, {"upload_id": up, "action": "approve", "scope_ref": "dept:ops"}, conn)
    with pytest.raises(N.NodeError):
        _run("u_ops", N.handle_upload_review, {"upload_id": up, "action": "reject"}, conn)
