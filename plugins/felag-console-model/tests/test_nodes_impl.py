"""节点纯逻辑测试。用内存桩替掉 conn / provider / server,不依赖 PG 与 felag-server。

重点守两件事:
  ① 权限:非超管一律拒(模型与密钥直接决定 LLM 账单与可用性);
  ② 🔒 密钥不留痕:key 不进库、不进审计 detail、不出现在返回值里。
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest
from _lib import nodes_impl, server
from _lib.nodes_impl import NodeError
from _lib.provider import StubSuperadminProvider


class FakeConn:
    """记录 set_config / add_audit 的内存桩(不碰真 DB)。"""

    def __init__(self, cfg=None):
        self.cfg = dict(cfg or {})
        self.audits = []
        self.committed = False

    def commit(self):
        self.committed = True


@pytest.fixture(autouse=True)
def patch_store(monkeypatch):
    """把 store 的读写打到 FakeConn 上。"""
    monkeypatch.setattr(nodes_impl.store, "get_config", lambda conn, k: conn.cfg.get(k, ""))
    monkeypatch.setattr(nodes_impl.store, "set_config",
                        lambda conn, k, v: conn.cfg.__setitem__(k, v))
    monkeypatch.setattr(nodes_impl.store, "config_view",
                        lambda conn: {"felag_server_base": conn.cfg.get("felag_server_base", ""),
                                      "felag_model_admin_token": bool(conn.cfg.get("felag_model_admin_token"))})
    monkeypatch.setattr(nodes_impl.store, "add_audit",
                        lambda conn, actor, action, target, detail: conn.audits.append(
                            {"actor": actor, "action": action, "target": target, "detail": detail}))


def _configured_conn():
    return FakeConn({"felag_server_base": "http://felag:28080", "felag_model_admin_token": "svc-tok"})


def _actor(is_super=True):
    p = StubSuperadminProvider(is_superadmin=is_super)
    return p, p.get_actor(None)


# ── 权限 ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("handler,params", [
    (nodes_impl.handle_model_list, {}),
    (nodes_impl.handle_model_upsert, {"model_name": "a", "upstream": "b/c"}),
    (nodes_impl.handle_model_delete, {"model_id": "m1"}),
    (nodes_impl.handle_model_set_config, {"config": {"felag_server_base": "x"}}),
])
def test_non_superadmin_rejected(handler, params):
    provider, actor = _actor(is_super=False)
    with pytest.raises(NodeError, match="超管"):
        handler(params, _configured_conn(), provider, actor)


# ── 列表 ──────────────────────────────────────────────────────────────

def test_list_without_config_returns_hint_not_error():
    """首次使用(未配连接)不是错误,是引导态 —— 报错会让人以为坏了。"""
    provider, actor = _actor()
    out = nodes_impl.handle_model_list({}, FakeConn(), provider, actor)
    assert out["configured"] is False and out["models"] == [] and out["hint"]


def test_list_passes_through_server_view(monkeypatch):
    provider, actor = _actor()
    monkeypatch.setattr(server, "list_models",
                        lambda b, t: [{"modelName": "deepseek-v4-pro", "keyConfigured": True}])
    out = nodes_impl.handle_model_list({}, _configured_conn(), provider, actor)
    assert out["configured"] is True
    assert out["models"][0]["modelName"] == "deepseek-v4-pro"
    # 配置视图里令牌只能是布尔,不能是值
    assert out["config"]["felag_model_admin_token"] is True


# ── 新增 / 更新 ────────────────────────────────────────────────────────

def test_upsert_requires_fields():
    provider, actor = _actor()
    with pytest.raises(NodeError, match="模型名"):
        nodes_impl.handle_model_upsert({"upstream": "b/c"}, _configured_conn(), provider, actor)
    with pytest.raises(NodeError, match="上游模型"):
        nodes_impl.handle_model_upsert({"model_name": "a"}, _configured_conn(), provider, actor)


def test_upsert_key_never_persisted_or_audited(monkeypatch):
    """🔒 核心红线:密钥只透传给 server,不进库、不进审计、不进返回值。"""
    provider, actor = _actor()
    conn = _configured_conn()
    seen = {}
    monkeypatch.setattr(server, "upsert_model",
                        lambda b, t, n, u, k, ab: seen.update(key=k, name=n, upstream=u))

    out = nodes_impl.handle_model_upsert(
        {"model_name": "glm", "upstream": "openai/glm-4.6v-flash", "api_key": "sk-verysecret-zhipu"},
        conn, provider, actor)

    # 透传到了 server
    assert seen["key"] == "sk-verysecret-zhipu"
    # 但任何落地面都不含它
    blob = repr(conn.cfg) + repr(conn.audits) + repr(out)
    assert "verysecret" not in blob, f"密钥泄漏到了落地面: {blob}"
    # 审计只留形态描述
    assert conn.audits[0]["detail"]["key"] == "已更新为新的明文密钥"
    assert conn.committed


def test_upsert_env_ref_recorded_as_reference(monkeypatch):
    provider, actor = _actor()
    conn = _configured_conn()
    monkeypatch.setattr(server, "upsert_model", lambda *a: None)
    nodes_impl.handle_model_upsert(
        {"model_name": "ds", "upstream": "deepseek/x", "api_key": "os.environ/DEEPSEEK_API_KEY"},
        conn, provider, actor)
    assert conn.audits[0]["detail"]["key"] == "引用环境变量 DEEPSEEK_API_KEY"


def test_upsert_blank_key_means_unchanged(monkeypatch):
    provider, actor = _actor()
    conn = _configured_conn()
    monkeypatch.setattr(server, "upsert_model", lambda *a: None)
    nodes_impl.handle_model_upsert({"model_name": "ds", "upstream": "deepseek/x"}, conn, provider, actor)
    assert conn.audits[0]["detail"]["key"] == "未改动"


def test_upsert_surfaces_server_error(monkeypatch):
    provider, actor = _actor()

    def boom(*a):
        raise server.ServerError("felag-server 未开启模型治理端点")

    monkeypatch.setattr(server, "upsert_model", boom)
    with pytest.raises(NodeError, match="未开启模型治理端点"):
        nodes_impl.handle_model_upsert({"model_name": "a", "upstream": "b/c"},
                                       _configured_conn(), provider, actor)


# ── 删除 ──────────────────────────────────────────────────────────────

def test_delete_requires_id(monkeypatch):
    provider, actor = _actor()
    with pytest.raises(NodeError, match="id"):
        nodes_impl.handle_model_delete({}, _configured_conn(), provider, actor)


def test_delete_audits_name(monkeypatch):
    provider, actor = _actor()
    conn = _configured_conn()
    monkeypatch.setattr(server, "delete_model", lambda b, t, i: None)
    nodes_impl.handle_model_delete({"model_id": "m1", "model_name": "glm"}, conn, provider, actor)
    assert conn.audits[0]["action"] == "model.delete" and conn.audits[0]["target"] == "glm"


# ── 连接配置 ──────────────────────────────────────────────────────────

def test_set_config_rejects_unknown_key():
    provider, actor = _actor()
    with pytest.raises(NodeError, match="非法配置键"):
        nodes_impl.handle_model_set_config({"config": {"evil": "x"}}, FakeConn(), provider, actor)


def test_set_config_blank_keeps_existing():
    """留空 = 不改动该项(便于只改地址不重填令牌)。"""
    provider, actor = _actor()
    conn = _configured_conn()
    nodes_impl.handle_model_set_config(
        {"config": {"felag_server_base": "http://new:28080", "felag_model_admin_token": ""}},
        conn, provider, actor)
    assert conn.cfg["felag_server_base"] == "http://new:28080"
    assert conn.cfg["felag_model_admin_token"] == "svc-tok"  # 未被清空


def test_set_config_audit_records_keys_only():
    """🔒 审计只记键名,不记值(令牌同样是秘密)。"""
    provider, actor = _actor()
    conn = FakeConn()
    out = nodes_impl.handle_model_set_config(
        {"config": {"felag_model_admin_token": "svc-supersecret"}}, conn, provider, actor)
    blob = repr(conn.audits) + repr(out)
    assert "supersecret" not in blob, f"令牌泄漏: {blob}"
    assert conn.audits[0]["detail"]["keys"] == ["felag_model_admin_token"]
    assert out["config"]["felag_model_admin_token"] is True
