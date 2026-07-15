from _lib import store

def test_create_and_get(conn):
    sid = store.create_source(conn, "https://github.com/bestfunc/bi_plugins", "daily-report-test", "dept:1", "u1")
    row = store.get_source(conn, sid)
    assert row["git_url"].endswith("bi_plugins") and row["plugin"] == "daily-report-test"
    assert row["status"] == "draft" and row["scope_ref"] == "dept:1"
    assert row["display_name"] is None       # 未填展示名 → NULL

def test_display_name_roundtrip(conn):
    sid = store.create_source(conn, "g", "p", "dept:1", "u1", display_name="智能质量")
    assert store.get_source(conn, sid)["display_name"] == "智能质量"
    # 空串归一为 NULL(下游据此回退用包名)
    sid2 = store.create_source(conn, "g", "p2", "dept:1", "u1", display_name="")
    assert store.get_source(conn, sid2)["display_name"] is None

def test_review_cas(conn):
    sid = store.create_source(conn, "g", "p", "dept:1", "u1")
    assert store.review_source(conn, sid, "rev") is True        # draft→approved 命中
    assert store.review_source(conn, sid, "rev") is False       # 再审不命中(非 draft)
    assert store.get_source(conn, sid)["status"] == "approved"

def test_deprecate_and_approved_list(conn):
    a = store.create_source(conn, "g", "pa", "dept:1", "u1"); store.review_source(conn, a, "r")
    b = store.create_source(conn, "g", "pb", "dept:2", "u1")   # 保持 draft
    approved = store.list_approved_sources(conn)
    names = {r["plugin"] for r in approved}
    assert "pa" in names and "pb" not in names                 # 只 approved
    assert store.deprecate_source(conn, a, "r") is True
    assert "pa" not in {r["plugin"] for r in store.list_approved_sources(conn)}  # deprecated 不再 approved

def test_list_by_scopes_filter(conn):
    store.create_source(conn, "g", "p1", "dept:1", "u1")
    store.create_source(conn, "g", "p9", "dept:9", "u1")
    rows = store.list_sources_by_scopes(conn, ["dept:1"])
    assert {r["plugin"] for r in rows} == {"p1"}

def test_delete_only_draft_or_deprecated(conn):
    sid = store.create_source(conn, "g", "p", "dept:1", "u1")
    store.review_source(conn, sid, "r")                        # → approved
    assert store.delete_source(conn, sid) is False             # approved 不可删
    assert store.deprecate_source(conn, sid, "r") is True
    assert store.delete_source(conn, sid) is True              # deprecated 可删
