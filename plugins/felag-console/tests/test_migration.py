from tests.conftest import TABLE_PREFIX


def test_tables_created(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass(%s)", (TABLE_PREFIX + "skills",))
        assert cur.fetchone()[0] is not None
        cur.execute("SELECT to_regclass(%s)", (TABLE_PREFIX + "versions",))
        assert cur.fetchone()[0] is not None
        cur.execute("SELECT to_regclass(%s)", (TABLE_PREFIX + "audit",))
        assert cur.fetchone()[0] is not None


def test_partial_unique_index_allows_softdeleted_name_reuse(conn):
    with conn.cursor() as cur:
        cur.execute(
            f"INSERT INTO {TABLE_PREFIX}skills(name,scope_ref,deleted_at) VALUES('dup','dept:ops',now())"
        )
        cur.execute(
            f"INSERT INTO {TABLE_PREFIX}skills(name,scope_ref) VALUES('dup','dept:ops')"
        )  # 软删行不占活跃唯一空间 → 不报错
    conn.commit()
