import pathlib

def test_migration_creates_tables(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass('plg_felagplugin_sources'), to_regclass('plg_felagplugin_audit')")
        s, a = cur.fetchone()
    assert s is not None and a is not None

def test_migration_bridge2_rules():
    sql = (pathlib.Path(__file__).resolve().parents[1] / "migrations" / "001_init.up.sql").read_text(encoding="utf-8")
    lo = sql.lower()
    assert "grant" not in lo and "revoke" not in lo         # 禁 GRANT
    assert "do $$" not in lo and "do $" not in lo            # 禁匿名 DO 块
    assert "create function" not in lo and "create trigger" not in lo and "create extension" not in lo
    # 只建 ${table_prefix} 对象
    import re
    for m in re.findall(r"create table (?:if not exists )?(\S+)", lo):
        assert m.startswith("${table_prefix}".lower())
