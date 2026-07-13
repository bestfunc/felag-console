import json
import pytest
import psycopg2
from _lib import store

def test_insert_and_list(conn):
    a = store.insert_draft(conn, "0.0.27", "windows", "win说明", "felag-client-setup-v0.0.27.exe", "aa", 100, "u1")
    store.insert_draft(conn, "0.0.27", "darwin", "mac说明", "felag-client-v0.0.27.dmg", "bb", 200, "u1")
    conn.commit()
    rows = store.list_all(conn)
    assert len(rows) == 2
    json.dumps(rows)   # created_at datetime 不转 isoformat 会抛
    assert store.get(conn, a)["version"] == "0.0.27"

def test_unique_version_platform(conn):
    store.insert_draft(conn, "0.0.27", "windows", "", "a.exe", "aa", 1, "u1")
    conn.commit()
    with pytest.raises(psycopg2.errors.UniqueViolation):
        store.insert_draft(conn, "0.0.27", "windows", "", "a.exe", "aa", 1, "u1")
    conn.rollback()
    # 同版本不同平台可共存
    store.insert_draft(conn, "0.0.27", "darwin", "", "a.dmg", "bb", 1, "u1")
    conn.commit()

def test_set_current_per_platform(conn):
    w1 = store.insert_draft(conn, "0.0.26", "windows", "", "w26.exe", "a", 1, "u")
    w2 = store.insert_draft(conn, "0.0.27", "windows", "", "w27.exe", "b", 1, "u")
    d1 = store.insert_draft(conn, "0.0.27", "darwin", "", "d27.dmg", "c", 1, "u")
    conn.commit()
    assert store.set_current(conn, w2, "windows"); conn.commit()
    assert store.set_current(conn, d1, "darwin"); conn.commit()
    # 切 windows 回滚到 w1,不影响 darwin 当前版
    assert store.set_current(conn, w1, "windows"); conn.commit()
    rows = {r["id"]: r for r in store.list_all(conn)}
    assert rows[w1]["is_current"] and not rows[w2]["is_current"]
    assert rows[d1]["is_current"]   # darwin 当前版不受 windows 切换影响

def test_delete_only_non_current(conn):
    w = store.insert_draft(conn, "0.0.27", "windows", "", "w.exe", "a", 1, "u")
    conn.commit()
    store.set_current(conn, w, "windows"); conn.commit()
    assert store.delete(conn, w) is False   # 当前版删不掉
    conn.rollback()
    w2 = store.insert_draft(conn, "0.0.28", "windows", "", "w2.exe", "b", 1, "u")
    conn.commit()
    assert store.delete(conn, w2) is True; conn.commit()

def test_get_config(conn):
    assert store.get_config(conn, "felag_server_base") == ""   # 未配 → 空
    with conn.cursor() as cur:
        cur.execute("INSERT INTO plg_felagapp_config (k,v) VALUES ('felag_server_base','http://x:28080')")
    conn.commit()
    assert store.get_config(conn, "felag_server_base") == "http://x:28080"
