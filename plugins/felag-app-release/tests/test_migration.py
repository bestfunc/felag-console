import pathlib, re

def test_migration_creates_tables(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass('plg_felagapp_releases'), to_regclass('plg_felagapp_audit'), to_regclass('plg_felagapp_config')")
        r, a, c = cur.fetchone()
    assert r is not None and a is not None and c is not None

def test_migration_one_current_per_platform(conn):
    """partial unique index (platform) WHERE is_current:每平台至多一个当前版,跨平台互不干扰。"""
    with conn.cursor() as cur:
        cur.execute("INSERT INTO plg_felagapp_releases (version,platform,filename,sha256,is_current) VALUES "
                    "('1','windows','a.exe','x',true),('1','darwin','a.dmg','y',true)")  # 两平台各一 current → OK
        conn.commit()
        # 同平台再来一个 current → 违反 partial unique index
        import psycopg2
        try:
            cur.execute("INSERT INTO plg_felagapp_releases (version,platform,filename,sha256,is_current) VALUES ('2','windows','b.exe','z',true)")
            conn.commit()
            assert False, "同平台第二个 current 应被 partial unique index 拒"
        except psycopg2.errors.UniqueViolation:
            conn.rollback()

def test_migration_bridge2_rules():
    mig_dir = pathlib.Path(__file__).resolve().parents[1] / "migrations"
    for f in sorted(mig_dir.glob("*.up.sql")):
        lo = f.read_text(encoding="utf-8").lower()
        assert "grant" not in lo and "revoke" not in lo         # 禁 GRANT
        assert "do $$" not in lo and "do $" not in lo            # 禁匿名 DO 块
        assert "create function" not in lo and "create trigger" not in lo and "create extension" not in lo
        # create table / index / alter 只碰 ${table_prefix} 对象
        for m in re.findall(r"(?:create table (?:if not exists )?|alter table |create unique index (?:if not exists )?)(\S+)", lo):
            assert m.startswith("${table_prefix}".lower()), f"{f.name}: {m} 非自有前缀对象"
