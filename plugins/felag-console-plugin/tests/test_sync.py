"""插件源「更新」触发 + 版本探测(本次功能)。
- probe_version:纯函数,monkeypatch _read_retry,不打网络,本地可跑。
- request_sync / handle_plugin_source_sync:需真 PG(conn fixture),CI 跑。
"""
import base64
import json
import pytest
from _lib import discover, store, nodes_impl as N


# ── probe_version(免 DB / 免网络)──

def test_probe_version_ok(monkeypatch):
    payload = {"encoding": "base64",
               "content": base64.b64encode(json.dumps({"name": "foo", "version": "1.2.3"}).encode()).decode()}
    monkeypatch.setattr(discover, "_read_retry", lambda req, timeout, cap, attempts=2: json.dumps(payload).encode())
    assert discover.probe_version("https://github.com/o/r", "latest", "foo") == "1.2.3"


def test_probe_version_non_github_returns_none():
    # 非 github 源:_owner_repo 抛 ValueError → 软失败 None(不打网络)
    assert discover.probe_version("https://gitlab.com/o/r", "main", "foo") is None


def test_probe_version_network_error_soft_fails(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("network down")
    monkeypatch.setattr(discover, "_read_retry", boom)
    assert discover.probe_version("https://github.com/o/r", "main", "foo") is None


def test_probe_version_empty_version_returns_none(monkeypatch):
    payload = {"encoding": "base64",
               "content": base64.b64encode(json.dumps({"name": "foo", "version": ""}).encode()).decode()}
    monkeypatch.setattr(discover, "_read_retry", lambda req, timeout, cap, attempts=2: json.dumps(payload).encode())
    assert discover.probe_version("https://github.com/o/r", "main", "foo") is None


# ── request_sync / handle_plugin_source_sync(需 conn fixture)──

class _Actor:
    def __init__(self, uid, name="", dept_ref=None):
        self.user_id = uid; self.name = name; self.dept_ref = dept_ref


class _StubProvider:
    def __init__(self, manageable): self._m = set(manageable)
    def can_manage_scope(self, actor, scope_ref): return scope_ref in self._m
    def manageable_scope_refs(self, actor): return set(self._m)


def test_request_sync_only_approved(conn):
    sid = store.create_source(conn, "https://github.com/o/r", "p", "dept:1", "u1")
    conn.commit()
    assert store.request_sync(conn, sid) is False           # draft → 不置
    store.review_source(conn, sid, "admin"); conn.commit()
    assert store.request_sync(conn, sid) is True            # approved → 置
    conn.commit()
    assert store.get_source(conn, sid)["sync_requested_at"] is not None


def test_handle_sync_approved_ok_and_audited(conn):
    p = _StubProvider(["dept:1"]); a = _Actor("u1")
    sid = store.create_source(conn, "https://github.com/o/r", "p", "dept:1", "u1")
    store.review_source(conn, sid, "admin"); conn.commit()
    out = N.handle_plugin_source_sync({"source_id": sid}, conn, p, a)
    assert out["sync_requested"] is True
    assert store.get_source(conn, sid)["sync_requested_at"] is not None
    with conn.cursor() as cur:
        cur.execute(f"SELECT count(*) FROM {store.P}audit WHERE action='source.sync_request' AND target=%s",
                    (f"source:{sid}",))
        assert cur.fetchone()[0] == 1


def test_handle_sync_rejects_draft(conn):
    p = _StubProvider(["dept:1"]); a = _Actor("u1")
    sid = store.create_source(conn, "https://github.com/o/r", "p", "dept:1", "u1")  # draft
    conn.commit()
    with pytest.raises(N.NodeError):
        N.handle_plugin_source_sync({"source_id": sid}, conn, p, a)


def test_handle_sync_rejects_cross_scope(conn):
    p = _StubProvider(["dept:1"]); a = _Actor("u1")
    sid = store.create_source(conn, "https://github.com/o/r", "p9", "dept:9", "u1")
    store.review_source(conn, sid, "admin"); conn.commit()
    with pytest.raises(N.NodeError):   # 不可管 dept:9 → 不暴露存在性
        N.handle_plugin_source_sync({"source_id": sid}, conn, p, a)
