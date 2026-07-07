import os, pathlib, psycopg2, pytest

TABLE_PREFIX = "plg_felagskill_"
_MIG = pathlib.Path(__file__).resolve().parents[1] / "migrations" / "001_init.up.sql"


def _apply_migration(c):
    sql = _MIG.read_text(encoding="utf-8").replace("${table_prefix}", TABLE_PREFIX)
    with c.cursor() as cur:
        cur.execute(
            f"DROP TABLE IF EXISTS {TABLE_PREFIX}audit, {TABLE_PREFIX}versions, {TABLE_PREFIX}skills CASCADE"
        )
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
