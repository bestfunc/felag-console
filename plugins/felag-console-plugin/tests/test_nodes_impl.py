import json
import pytest
from _lib import nodes_impl as N, store
from _lib.orgprovider import ScopeNode

class Actor:
    def __init__(self, uid, name="", dept_ref=None):
        self.user_id = uid; self.name = name; self.dept_ref = dept_ref

class StubProvider:
    """只认 dept:1 可管；dept:9 不可管。用于反查纪律测试。
    list_manageable_scopes 返回真 ScopeNode 对象（与 PlatformOrgProvider 同类型），
    以真实暴露 handler 的 JSON 序列化路径。"""
    def __init__(self, manageable): self._m = set(manageable)
    def can_manage_scope(self, actor, scope_ref): return scope_ref in self._m
    def manageable_scope_refs(self, actor): return set(self._m)
    def list_manageable_scopes(self, actor): return [ScopeNode(s, s, None) for s in self._m]

def test_actor_context_json_serializable(conn):
    # 真 provider 返回 ScopeNode 对象；handler 必须序列化为 dict，否则运行时 emit_output 崩
    # （"Object of type ScopeNode is not JSON serializable"）。非空 scope 才触发。
    p = StubProvider(["dept:1", "pos:2"]); a = Actor("u1", "运维", "dept:1")
    out = N.handle_actor_context({}, conn, p, a)
    json.dumps(out)   # 不可序列化会抛 TypeError → fail
    assert {x["scope_ref"] for x in out["manageable_scopes"]} == {"dept:1", "pos:2"}
    assert out["actor"]["user_id"] == "u1"

def test_create_reverse_check(conn):
    p = StubProvider(["dept:1"]); a = Actor("u1")
    out = N.handle_plugin_source_create({"git_url": "g", "plugin": "p", "scope_ref": "dept:1"}, conn, p, a)
    assert out["id"] > 0
    with pytest.raises(N.NodeError):   # 越 scope 建 → 拒
        N.handle_plugin_source_create({"git_url": "g", "plugin": "p2", "scope_ref": "dept:9"}, conn, p, a)

def test_review_reverse_check_and_cas(conn):
    p = StubProvider(["dept:1"]); a = Actor("u1")
    sid = store.create_source(conn, "g", "p", "dept:1", "u1")
    out = N.handle_plugin_source_review({"source_id": sid, "action": "approve"}, conn, p, a)
    assert out["status"] == "approved"
    with pytest.raises(N.NodeError):   # 再审(非 draft)→ 409
        N.handle_plugin_source_review({"source_id": sid, "action": "approve"}, conn, p, a)
    # 越 scope 审 → 不暴露存在性
    sid9 = store.create_source(conn, "g", "p9", "dept:9", "u1")
    with pytest.raises(N.NodeError):
        N.handle_plugin_source_review({"source_id": sid9, "action": "approve"}, conn, p, a)

def test_list_only_manageable(conn):
    p = StubProvider(["dept:1"]); a = Actor("u1")
    store.create_source(conn, "g", "p1", "dept:1", "u1")
    store.create_source(conn, "g", "p9", "dept:9", "u1")
    out = N.handle_plugin_source_list({}, conn, p, a)
    assert {r["plugin"] for r in out["sources"]} == {"p1"}
    json.dumps(out)   # created_at/reviewed_at datetime 不转 isoformat 会抛 → fail

def test_audit_list_json_serializable(conn):
    p = StubProvider(["dept:1"]); a = Actor("u1")
    store.add_audit(conn, "u1", "dept:1", "source.create", "source:1", {"k": "v"}); conn.commit()
    out = N.handle_audit_list({}, conn, p, a)
    json.dumps(out)   # ts datetime 不转会抛
    assert any(r["scope_ref"] == "dept:1" for r in out["audit"])

def test_delete_reverse_check(conn):
    p = StubProvider(["dept:1"]); a = Actor("u1")
    sid = store.create_source(conn, "g", "p", "dept:1", "u1")
    out = N.handle_plugin_source_delete({"source_id": sid}, conn, p, a)
    assert out["deleted"] is True

def test_delete_reverse_check_out_of_scope(conn):
    p = StubProvider(["dept:1"]); a = Actor("u1")
    sid9 = store.create_source(conn, "g", "p9", "dept:9", "u1")
    with pytest.raises(N.NodeError):   # 越 scope 删 → 不暴露存在性
        N.handle_plugin_source_delete({"source_id": sid9}, conn, p, a)

def test_delete_cas_miss(conn):
    p = StubProvider(["dept:1"]); a = Actor("u1")
    sid = store.create_source(conn, "g", "p", "dept:1", "u1")
    store.review_source(conn, sid, "r")   # draft -> approved
    with pytest.raises(N.NodeError):   # approved 非 draft/deprecated，CAS 未命中 409
        N.handle_plugin_source_delete({"source_id": sid}, conn, p, a)
