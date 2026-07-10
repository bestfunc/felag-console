import os, pathlib, psycopg2, pytest

TABLE_PREFIX = "plg_felagplugin_"
_MIG_DIR = pathlib.Path(__file__).resolve().parents[1] / "migrations"


def _apply_migration(c):
    with c.cursor() as cur:
        cur.execute(f"DROP TABLE IF EXISTS {TABLE_PREFIX}audit, {TABLE_PREFIX}sources CASCADE")
        for f in sorted(_MIG_DIR.glob("*.up.sql")):   # 001 建表 → 002 加 branch,按序应用
            cur.execute(f.read_text(encoding="utf-8").replace("${table_prefix}", TABLE_PREFIX))
    c.commit()


@pytest.fixture
def conn():
    dsn = os.environ.get(
        "FELAG_CONSOLE_TEST_DSN",
        "postgres://bestfunc:bestfunc_dev@localhost:5432/felag_console_test?sslmode=disable",
    )
    c = psycopg2.connect(dsn)
    _apply_migration(c)
    yield c
    c.close()
