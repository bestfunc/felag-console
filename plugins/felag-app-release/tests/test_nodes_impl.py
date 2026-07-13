import base64
import json
import pytest
from _lib import nodes_impl as N, store, server
from _lib.provider import StubSuperadminProvider

SUPER = StubSuperadminProvider(is_superadmin=True, user_id="1", name="超管")
NORMAL = StubSuperadminProvider(is_superadmin=False, user_id="2", name="普通")

def _actor(p):
    return p.get_actor(None)

def _set_cfg(conn):
    with conn.cursor() as cur:
        cur.execute("INSERT INTO plg_felagapp_config (k,v) VALUES ('felag_server_base','http://x:28080'),('felag_app_upload_token','tok')")
    conn.commit()

def test_non_superadmin_rejected_all_nodes(conn):
    a = _actor(NORMAL)
    for fn, params in [
        (N.handle_release_list, {}),
        (N.handle_release_upload, {"version": "1", "platform": "windows", "content_b64": base64.b64encode(b"x").decode()}),
        (N.handle_release_publish, {"release_id": 1}),
        (N.handle_release_delete, {"release_id": 1}),
    ]:
        with pytest.raises(N.NodeError):
            fn(params, conn, NORMAL, a)

def test_upload_writes_draft(conn, monkeypatch):
    _set_cfg(conn)
    a = _actor(SUPER)
    monkeypatch.setattr(server, "upload",
        lambda base, tok, v, p, notes, data: {"filename": f"felag-client-setup-v{v}.exe", "sha256": "deadbeef", "size": len(data)})
    b64 = base64.b64encode(b"INSTALLER").decode()
    out = N.handle_release_upload({"version": "0.0.27", "platform": "windows", "notes": "n", "content_b64": b64}, conn, SUPER, a)
    assert out["filename"] == "felag-client-setup-v0.0.27.exe" and out["sha256"] == "deadbeef"
    rows = store.list_all(conn)
    assert len(rows) == 1 and rows[0]["is_current"] is False and rows[0]["uploaded_by"] == "1"

def test_upload_bad_platform(conn):
    a = _actor(SUPER)
    with pytest.raises(N.NodeError):
        N.handle_release_upload({"version": "1", "platform": "linux", "content_b64": base64.b64encode(b"x").decode()}, conn, SUPER, a)

def test_upload_duplicate_friendly(conn, monkeypatch):
    _set_cfg(conn)
    a = _actor(SUPER)
    monkeypatch.setattr(server, "upload",
        lambda *args, **kw: {"filename": "felag-client-setup-v0.0.27.exe", "sha256": "x", "size": 1})
    b64 = base64.b64encode(b"x").decode()
    N.handle_release_upload({"version": "0.0.27", "platform": "windows", "content_b64": b64}, conn, SUPER, a)
    with pytest.raises(N.NodeError):   # (version,platform) 重复 → 友好报错
        N.handle_release_upload({"version": "0.0.27", "platform": "windows", "content_b64": b64}, conn, SUPER, a)

def test_publish_switches_current_per_platform(conn):
    a = _actor(SUPER)
    w1 = store.insert_draft(conn, "0.0.26", "windows", "", "w26.exe", "a", 1, "1")
    w2 = store.insert_draft(conn, "0.0.27", "windows", "", "w27.exe", "b", 1, "1")
    d1 = store.insert_draft(conn, "0.0.27", "darwin", "", "d27.dmg", "c", 1, "1")
    conn.commit()
    N.handle_release_publish({"release_id": w2}, conn, SUPER, a)
    N.handle_release_publish({"release_id": d1}, conn, SUPER, a)
    N.handle_release_publish({"release_id": w1}, conn, SUPER, a)   # windows 回滚
    rows = {r["id"]: r for r in store.list_all(conn)}
    assert rows[w1]["is_current"] and not rows[w2]["is_current"] and rows[d1]["is_current"]

def test_delete_current_rejected(conn, monkeypatch):
    a = _actor(SUPER)
    w = store.insert_draft(conn, "0.0.27", "windows", "", "w.exe", "a", 1, "1")
    conn.commit()
    N.handle_release_publish({"release_id": w}, conn, SUPER, a)
    with pytest.raises(N.NodeError):   # 当前版拒删(未触达 server.delete)
        N.handle_release_delete({"release_id": w}, conn, SUPER, a)

def test_delete_non_current(conn, monkeypatch):
    _set_cfg(conn)
    a = _actor(SUPER)
    w = store.insert_draft(conn, "0.0.28", "windows", "", "w28.exe", "a", 1, "1")
    conn.commit()
    called = {}
    monkeypatch.setattr(server, "delete", lambda base, tok, fn: called.setdefault("fn", fn))
    out = N.handle_release_delete({"release_id": w}, conn, SUPER, a)
    assert out["deleted"] is True and called["fn"] == "w28.exe"
    assert store.get(conn, w) is None
