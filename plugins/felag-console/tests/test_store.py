import psycopg2, pytest
from _lib import store

def test_create_get_skill(conn):
    sid = store.create_skill(conn, "deploy", "dept:ops", "u_ops")
    conn.commit()
    s = store.get_skill(conn, sid)
    assert s["name"] == "deploy" and s["scope_ref"] == "dept:ops" and s["status"] == "active"

def test_create_duplicate_active_name_raises(conn):
    store.create_skill(conn, "deploy", "dept:ops", "u_ops"); conn.commit()
    with pytest.raises(psycopg2.errors.UniqueViolation):
        store.create_skill(conn, "deploy", "dept:ops", "u_ops")
    conn.rollback()

def test_softdelete_frees_name(conn):
    sid = store.create_skill(conn, "deploy", "dept:ops", "u_ops"); conn.commit()
    store.soft_delete_skill(conn, sid); conn.commit()
    sid2 = store.create_skill(conn, "deploy", "dept:impl", "u_impl"); conn.commit()  # 不撞
    assert sid2 != sid

def test_add_version_pending_then_publish(conn):
    sid = store.create_skill(conn, "deploy", "dept:ops", "u_ops"); conn.commit()
    vid = store.add_version(conn, sid, "1.0.0", b"pkg", "sha", "u_ops"); conn.commit()
    assert store.get_version(conn, vid)["review_status"] == "pending"
    ok = store.review_version(conn, vid, approve=True, reviewer="u_ops", self_review=True); conn.commit()
    assert ok is True
    store.set_current_version(conn, sid, vid); conn.commit()
    v = store.get_version(conn, vid)
    assert v["review_status"] == "published" and v["self_review"] is True
    assert store.get_skill(conn, sid)["current_version_id"] == vid

def test_review_conditional_update_blocks_double(conn):
    sid = store.create_skill(conn, "deploy", "dept:ops", "u_ops"); conn.commit()
    vid = store.add_version(conn, sid, "1.0.0", b"pkg", "sha", "u_ops"); conn.commit()
    assert store.review_version(conn, vid, True, "u_ops", False) is True; conn.commit()
    # 已 published，再 approve 影响 0 行 → False（挡并发双发）
    assert store.review_version(conn, vid, True, "u_ops", False) is False; conn.commit()

def test_delete_pending_version_ok_published_rejected(conn):
    sid = store.create_skill(conn, "deploy", "dept:ops", "u_ops"); conn.commit()
    vid = store.add_version(conn, sid, "1.0.0", b"pkg", "sha", "u_ops"); conn.commit()
    assert store.delete_version(conn, vid) is True; conn.commit()  # pending 可删
    vid2 = store.add_version(conn, sid, "2.0.0", b"pkg", "sha", "u_ops"); conn.commit()
    store.review_version(conn, vid2, True, "u_ops", False); conn.commit()
    assert store.delete_version(conn, vid2) is False; conn.commit()  # published 拒删

def test_list_by_scopes(conn):
    store.create_skill(conn, "a", "dept:ops", "u_ops")
    store.create_skill(conn, "b", "dept:impl", "u_impl"); conn.commit()
    rows = store.list_skills_by_scopes(conn, {"dept:ops"})
    assert [r["name"] for r in rows] == ["a"]

def test_audit_roundtrip(conn):
    store.add_audit(conn, "u_ops", "dept:ops", "skill.create", "skill:1", {"self_review": False}); conn.commit()
    rows = store.list_audit(conn, scope_refs={"dept:ops"}, skill_id=None)
    assert rows and rows[0]["action"] == "skill.create"
    assert store.list_audit(conn, scope_refs=set(), skill_id=None) == []  # 可管空 → 无 audit
