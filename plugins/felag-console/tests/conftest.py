import os, pathlib, psycopg2, pytest

TABLE_PREFIX = "plg_felagskill_"
_MIG_DIR = pathlib.Path(__file__).resolve().parents[1] / "migrations"
_MIGS = ["001_init.up.sql", "002_uploads.up.sql"]


def _apply_migration(c):
    with c.cursor() as cur:
        cur.execute(
            f"DROP TABLE IF EXISTS {TABLE_PREFIX}uploads, {TABLE_PREFIX}audit, "
            f"{TABLE_PREFIX}versions, {TABLE_PREFIX}skills CASCADE"
        )
        for name in _MIGS:
            sql = (_MIG_DIR / name).read_text(encoding="utf-8").replace("${table_prefix}", TABLE_PREFIX)
            cur.execute(sql)
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
