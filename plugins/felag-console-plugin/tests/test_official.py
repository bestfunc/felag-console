"""官方插件启停 + 凭据 KV(store 层,直连 PG)。需 FELAG_CONSOLE_TEST_DSN 可达。"""
from _lib import store

G = "https://github.com/bestfunc/felag-console.git"
P = "feishu-mail"
B = "dev"


def test_enable_official_idempotent_and_status(conn):
    # 启用 dept:1 → approved 官方源;幂等再启用不重复、仍 approved
    sid1 = store.enable_official(conn, G, P, B, "dept:1", "飞书邮件", "admin")
    sid2 = store.enable_official(conn, G, P, B, "dept:1", "飞书邮件", "admin")
    assert sid1 == sid2  # ON CONFLICT 复用同一行
    row = store.get_source(conn, sid1)
    assert row["status"] == "approved" and row["scope_ref"] == "dept:1"
    # official_enabled_scopes 只返回该 git/plugin/branch 下已 approved 的 scope
    got = store.official_enabled_scopes(conn, G, P, B, ["dept:1", "dept:2"])
    assert got == {"dept:1"}


def test_disable_official(conn):
    store.enable_official(conn, G, P, B, "dept:2", "飞书邮件", "admin")
    assert store.disable_official(conn, G, P, B, "dept:2", "admin") is True   # approved→deprecated
    assert store.disable_official(conn, G, P, B, "dept:2", "admin") is False  # 再停不命中
    assert store.official_enabled_scopes(conn, G, P, B, ["dept:2"]) == set()


def test_official_excluded_from_third_party_list(conn):
    # 官方源不混进第三方 list_sources_by_scopes
    store.enable_official(conn, G, P, B, "dept:1", "飞书邮件", "admin")
    gid = store.create_source(conn, "g2", "other", "dept:1", "u1"); store.review_source(conn, gid, "r")
    conn.commit()
    plugins = {r["plugin"] for r in store.list_sources_by_scopes(conn, ["dept:1"])}
    assert "other" in plugins and "feishu-mail" not in plugins


def test_config_kv_roundtrip(conn):
    store.set_config(conn, "lark_app_id", "cli_abc")
    store.set_config(conn, "lark_app_secret", "sec_xyz")
    store.set_config(conn, "lark_app_id", "cli_new")  # upsert 覆盖
    conn.commit()
    cfg = store.get_config(conn, ["lark_app_id", "lark_app_secret", "nope"])
    assert cfg == {"lark_app_id": "cli_new", "lark_app_secret": "sec_xyz"}
