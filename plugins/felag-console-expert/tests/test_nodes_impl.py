"""节点逻辑单测:授权边界 + 状态机。

用假 store 而不是真库 —— 这些用例要钉的是「谁能动什么、动完变成什么状态」,
那是纯逻辑;接真库只会把它们变成需要 PG 才能跑的集成测,最后没人跑。
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from _lib import nodes_impl, store  # noqa: E402

GOOD_MD = """---
name: acoustic-inspector
displayName: 声学检测专家
profession: 工业声学检测
description: 产线声学检测
version: 0.1.0
---

你是声学检测专家。
"""


class ScopeNode:
    def __init__(self, scope_ref, label, parent_ref):
        self.scope_ref, self.label, self.parent_ref = scope_ref, label, parent_ref


class Actor:
    """字段必须与 orgprovider.Actor **完全一致**：user_id / name / dept_ref。

    这里曾经多了一个 `id`，而 nodes_impl 正好写的是 `actor.id` ——
    21 个用例全绿，上了 121 一点保存就 AttributeError。
    假对象比真对象宽松，测试就是在验证一个不存在的世界。别给它加字段。
    """

    def __init__(self, id_="u1"):
        self.user_id = id_
        self.name = "tester"
        self.dept_ref = "dept:1"


class Provider:
    """可管 dept:1;super 决定能否看孤儿/审计。"""

    def __init__(self, scopes=("dept:1",), super_admin=False):
        self._scopes, self._super = set(scopes), super_admin

    def can_manage_scope(self, actor, scope_ref):
        return self._super or scope_ref in self._scopes

    def manageable_scope_refs(self, actor):
        return self._scopes

    def can_manage_orphans(self, actor):
        return self._super

    def list_manageable_scopes(self, actor):
        return [ScopeNode(r, "部门" + r.split(":")[-1], None) for r in sorted(self._scopes)]


class FakeConn:
    def __init__(self):
        self.committed = False

    def commit(self):
        self.committed = True

    def rollback(self):
        pass


@pytest.fixture
def fake_store(monkeypatch):
    """把 store 的每个函数换成记账用的桩。"""
    state = {"rows": {}, "by_name": {}, "audit": [], "updates": [], "status": []}

    monkeypatch.setattr(store, "get", lambda c, i: state["rows"].get(int(i)))
    monkeypatch.setattr(store, "get_by_name", lambda c, n: state["by_name"].get(n))
    monkeypatch.setattr(store, "list_by_scopes", lambda c, s, su: list(state["rows"].values()))
    monkeypatch.setattr(store, "list_audit", lambda c, n=100: state["audit"])

    def _insert(c, **kw):
        new_id = len(state["rows"]) + 1
        row = dict(kw, id=new_id, status="pending")
        state["rows"][new_id] = row
        state["by_name"][kw["name"]] = row
        return new_id

    monkeypatch.setattr(store, "insert", _insert)
    monkeypatch.setattr(store, "update", lambda c, i, **kw: state["updates"].append((i, kw)))
    monkeypatch.setattr(store, "set_status",
                        lambda c, i, s, r, reason=None: state["status"].append((i, s, r, reason)))
    monkeypatch.setattr(store, "audit",
                        lambda c, a, s, act, t, d: state["audit"].append((a, s, act, t, d)))
    return state


def test_save_creates_pending(fake_store):
    out = nodes_impl.handle_expert_save(
        {"body": GOOD_MD, "scope_ref": "dept:1"}, FakeConn(), Provider(), Actor())
    assert out["name"] == "acoustic-inspector"
    # 新建一律进待审,不能直接 published
    assert out["status"] == "pending"
    assert fake_store["audit"][-1][2] == "expert_create"


def test_save_rejects_unmanaged_scope(fake_store):
    with pytest.raises(nodes_impl.NodeError, match="管理权限"):
        nodes_impl.handle_expert_save(
            {"body": GOOD_MD, "scope_ref": "dept-9"}, FakeConn(), Provider(), Actor())


def test_save_rejects_missing_scope(fake_store):
    with pytest.raises(nodes_impl.NodeError, match="作用域"):
        nodes_impl.handle_expert_save({"body": GOOD_MD}, FakeConn(), Provider(), Actor())


def test_save_rejects_invalid_md(fake_store):
    with pytest.raises(nodes_impl.NodeError, match="校验未过"):
        nodes_impl.handle_expert_save(
            {"body": "---\nname: x\n---\n正文", "scope_ref": "dept:1"},
            FakeConn(), Provider(), Actor())


def test_save_rejects_duplicate_name(fake_store):
    conn = FakeConn()
    nodes_impl.handle_expert_save({"body": GOOD_MD, "scope_ref": "dept:1"}, conn, Provider(), Actor())
    with pytest.raises(nodes_impl.NodeError, match="已存在"):
        nodes_impl.handle_expert_save({"body": GOOD_MD, "scope_ref": "dept:1"}, conn, Provider(), Actor())


def test_edit_rejects_rename(fake_store):
    """改名等于换一个 client 落盘目录、旧目录不会被清掉,所以直接禁掉。"""
    conn = FakeConn()
    nodes_impl.handle_expert_save({"body": GOOD_MD, "scope_ref": "dept:1"}, conn, Provider(), Actor())
    renamed = GOOD_MD.replace("name: acoustic-inspector", "name: other-name")
    with pytest.raises(nodes_impl.NodeError, match="不允许改名"):
        nodes_impl.handle_expert_save(
            {"expert_id": 1, "body": renamed, "scope_ref": "dept:1"}, conn, Provider(), Actor())


def test_edit_resets_to_pending(fake_store):
    """已发布的专家被改了正文,必须重新走审核 —— 否则等于用一次通过的审核放行没审过的内容。"""
    conn = FakeConn()
    nodes_impl.handle_expert_save({"body": GOOD_MD, "scope_ref": "dept:1"}, conn, Provider(), Actor())
    fake_store["rows"][1]["status"] = "published"
    out = nodes_impl.handle_expert_save(
        {"expert_id": 1, "body": GOOD_MD, "scope_ref": "dept:1"}, conn, Provider(), Actor())
    assert out["status"] == "pending"


def test_review_approve_publishes(fake_store):
    conn = FakeConn()
    nodes_impl.handle_expert_save({"body": GOOD_MD, "scope_ref": "dept:1"}, conn, Provider(), Actor())
    out = nodes_impl.handle_expert_review({"expert_id": 1, "approve": True}, conn, Provider(), Actor())
    assert out["status"] == "published"
    assert fake_store["status"][-1][1] == "published"


def test_review_reject_keeps_reason(fake_store):
    conn = FakeConn()
    nodes_impl.handle_expert_save({"body": GOOD_MD, "scope_ref": "dept:1"}, conn, Provider(), Actor())
    nodes_impl.handle_expert_review(
        {"expert_id": 1, "approve": False, "reason": "判断顺序写反了"}, conn, Provider(), Actor())
    assert fake_store["status"][-1][1] == "rejected"
    assert fake_store["status"][-1][3] == "判断顺序写反了"


def test_review_rejects_other_scope(fake_store):
    conn = FakeConn()
    nodes_impl.handle_expert_save({"body": GOOD_MD, "scope_ref": "dept:1"}, conn, Provider(), Actor())
    with pytest.raises(nodes_impl.NodeError, match="管理权限"):
        nodes_impl.handle_expert_review(
            {"expert_id": 1, "approve": True}, conn, Provider(scopes=("dept-2",)), Actor())


def test_deprecate_states_client_copy_not_removed(fake_store):
    """下架只停下发 —— 这个缺口必须在返回里说明白,免得管理员以为点一下就收回了。"""
    conn = FakeConn()
    nodes_impl.handle_expert_save({"body": GOOD_MD, "scope_ref": "dept:1"}, conn, Provider(), Actor())
    out = nodes_impl.handle_expert_deprecate({"expert_id": 1}, conn, Provider(), Actor())
    assert out["status"] == "deprecated"
    assert "不会被远程删除" in out["note"]


def test_audit_list_is_super_only(fake_store):
    with pytest.raises(nodes_impl.NodeError, match="仅超管"):
        nodes_impl.handle_audit_list({}, FakeConn(), Provider(), Actor())
    out = nodes_impl.handle_audit_list({}, FakeConn(), Provider(super_admin=True), Actor())
    assert "audit" in out


# actor_context 曾经是坡的：生成节点的脚本没替换模板默认 handler，
# run.py 里调的是 handle_expert_list，而当时根本没有 handle_actor_context。
# 因为没有任何用例碰过它，直到页面上选不出作用域才暴露。
def test_actor_context_returns_manageable_scopes():
    out = nodes_impl.handle_actor_context({}, FakeConn(), Provider(), Actor())
    assert out["actor"]["user_id"] == "u1"
    refs = [x["scope_ref"] for x in out["manageable_scopes"]]
    assert refs == ["dept:1"]
    # 形态必须是 `<type>:<id>`：server 端 EntitledScopes 产的就是这个串，
    # 一旦 UI 存成 `dept-1`，发布会成功而下发永远匹配不上、不报错。
    for r in refs:
        assert r.split(":")[0] in ("dept", "pos") and len(r.split(":")) == 2


def test_actor_context_empty_when_manages_nothing():
    out = nodes_impl.handle_actor_context({}, FakeConn(), Provider(scopes=()), Actor())
    assert out["manageable_scopes"] == []
