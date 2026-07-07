import os, pytest
from _lib import db

def test_connect_missing_dsn(monkeypatch):
    monkeypatch.delenv("DB_PLATFORM_PG_DSN", raising=False)
    with pytest.raises(RuntimeError, match="DB_PLATFORM_PG_DSN"):
        db.connect_platform()

def test_connect_ok(monkeypatch):
    dsn = os.environ.get(
        "FELAG_CONSOLE_TEST_DSN",
        "postgres://bestfunc:bestfunc_dev@localhost:5432/felag_console_test?sslmode=disable",
    )
    monkeypatch.setenv("DB_PLATFORM_PG_DSN", dsn)
    c = db.connect_platform()
    with c.cursor() as cur:
        cur.execute("SELECT 1")
        assert cur.fetchone()[0] == 1
    c.close()
