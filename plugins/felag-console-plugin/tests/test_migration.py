import pathlib

def test_migration_creates_tables(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass('plg_felagplugin_sources'), to_regclass('plg_felagplugin_audit')")
        s, a = cur.fetchone()
    assert s is not None and a is not None

def test_migration_bridge2_rules():
    import re
    mig_dir = pathlib.Path(__file__).resolve().parents[1] / "migrations"
    for f in sorted(mig_dir.glob("*.up.sql")):            # 所有迁移(001 + 002 …)都过桥2铁律
        lo = f.read_text(encoding="utf-8").lower()
        assert "grant" not in lo and "revoke" not in lo         # 禁 GRANT
        assert "do $$" not in lo and "do $" not in lo            # 禁匿名 DO 块
        assert "create function" not in lo and "create trigger" not in lo and "create extension" not in lo
        # create table / alter table 只碰 ${table_prefix} 对象
        for m in re.findall(r"(?:create table (?:if not exists )?|alter table )(\S+)", lo):
            assert m.startswith("${table_prefix}".lower()), f"{f.name}: {m} 非自有前缀对象"

def test_migration_002_adds_branch_column(conn):
    from _lib import store
    # 建源不传 branch → 默认 main;传 latest → 保留;同仓同插件同 scope 不同分支 = 两条(唯一键含 branch)
    a = store.create_source(conn, "https://github.com/o/r", "p", "dept:1", "u1")
    b = store.create_source(conn, "https://github.com/o/r", "p", "dept:1", "u1", branch="latest")
    conn.commit()
    rows = {r["id"]: r for r in store.list_sources_by_scopes(conn, ["dept:1"])}
    assert rows[a]["branch"] == "main"
    assert rows[b]["branch"] == "latest"
