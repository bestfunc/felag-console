"""节点逻辑单测。**不连真库**:用量真相源是网关 litellm 库,单测里用假 conn 喂固定结果,
断言的是权限门禁、参数校验、跨库 merge 的三级兜底、以及 CSV 口径 —— 这些才是会出错的地方。
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest
from _lib.nodes_impl import (handle_usage_summary, handle_usage_detail,
                             handle_usage_export, NodeError)
from _lib.provider import StubSuperadminProvider


class FakeCursor:
    """按 SQL 里的特征串挑一份预设结果返回。"""
    def __init__(self, canned):
        self._canned = canned
        self._rows = []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, args=None):
        for marker, rows in self._canned.items():
            if marker in sql:
                self._rows = rows
                return
        self._rows = []

    def fetchall(self):
        return self._rows

    def fetchone(self):
        return self._rows[0] if self._rows else None


class FakeConn:
    def __init__(self, canned):
        self._canned = canned
        self.committed = False

    def cursor(self):
        return FakeCursor(self._canned)

    def commit(self):
        self.committed = True


WINDOW = {"from": "2026-08-01", "to": "2026-08-24"}


def _ll(rows_by_marker=None):
    # 传入的标记优先匹配:明细 SQL 也含 to_char(本地时间列),放后面会被趋势那份抢走。
    canned = dict(rows_by_marker or {})
    defaults = {
        # to_char 只出现在按天分组(趋势)的 SQL 里 —— 必须排在 GROUP BY 1 前面,
        # 否则趋势查询会拿到员工维度那份多两列的行,zip 错位。
        "to_char": [("2026-08-24", 3, 100, 20, 120, 0.5)],
        "GROUP BY 1": [("7", "zhangsan", "yunwei", 3, 100, 20, 120, 0.5)],
        "SELECT count(*)": [(3,)],
        "count(*) AS requests, coalesce": [(3, 100, 20, 120, 0.5)],
        "DISTINCT model": [("deepseek-v4-pro",)],
    }
    for k, v in defaults.items():
        canned.setdefault(k, v)
    return FakeConn(canned)


def _pg(users=None):
    return FakeConn({"FROM users u": users if users is not None else [(7, "张三", "运维部")]})


def test_non_superadmin_is_rejected():
    actor = StubSuperadminProvider(is_superadmin=False).get_actor({})
    for fn in (handle_usage_summary, handle_usage_detail, handle_usage_export):
        with pytest.raises(NodeError):
            fn(dict(WINDOW), _ll(), _pg(), actor)


def test_window_is_required():
    actor = StubSuperadminProvider().get_actor({})
    with pytest.raises(NodeError):
        handle_usage_summary({"to": "2026-08-24"}, _ll(), _pg(), actor)
    with pytest.raises(NodeError):
        handle_usage_summary({"from": "2026-08-24", "to": "2026-08-01"}, _ll(), _pg(), actor)


def test_group_by_whitelist():
    """维度直接拼进 SQL,白名单外的值必须在节点层就被挡住(注入面)。"""
    actor = StubSuperadminProvider().get_actor({})
    with pytest.raises(NodeError):
        handle_usage_summary({**WINDOW, "group_by": "model; DROP TABLE x"}, _ll(), _pg(), actor)


def test_summary_resolves_name_from_platform_db():
    """平台库有这个人 → 用权威姓名与部门(而不是 spend log 里的快照)。"""
    actor = StubSuperadminProvider().get_actor({})
    out = handle_usage_summary({**WINDOW, "group_by": "employee"}, _ll(), _pg(), actor)
    row = out["rows"][0]
    assert row["display_name"] == "张三"
    assert row["dept_name"] == "运维部"
    assert row["total_tokens"] == 120
    assert out["totals"]["requests"] == 3
    assert out["models"] == ["deepseek-v4-pro"]


def test_summary_falls_back_to_snapshot_when_user_deleted():
    """员工已从平台删掉 → 平台库查不到 → 回落 spend log 里的快照名,不能显示成空。"""
    actor = StubSuperadminProvider().get_actor({})
    out = handle_usage_summary({**WINDOW, "group_by": "employee"}, _ll(), _pg(users=[]), actor)
    assert out["rows"][0]["display_name"] == "zhangsan"
    assert out["rows"][0]["dept_name"] == "yunwei"


def test_legacy_rows_without_attribution_are_kept_as_unattributed():
    """归属头上线前的历史请求没有 user_id —— 必须留下并标注,丢弃会让总量对不上网关账单。"""
    actor = StubSuperadminProvider().get_actor({})
    ll = _ll({"GROUP BY 1": [(None, None, None, 5, 10, 5, 15, 0.0)]})
    out = handle_usage_summary({**WINDOW, "group_by": "employee"}, ll, _pg(users=[]), actor)
    assert out["rows"][0]["display_name"] == "未归属"
    assert out["rows"][0]["total_tokens"] == 15


def test_detail_pagination_is_clamped():
    actor = StubSuperadminProvider().get_actor({})
    ll = _ll({"ORDER BY \"startTime\" DESC": [
        ("2026-08-24 12:00:00", "7", "zhangsan", "yunwei", "deepseek-v4-pro",
         100, 20, 120, 0.5, True, "PC-01", "10.0.0.9", "req-1")]})
    out = handle_usage_detail({**WINDOW, "page": 0, "page_size": 9999}, ll, _pg(), actor)
    assert out["page"] == 1 and out["page_size"] == 200
    assert out["rows"][0]["display_name"] == "张三"
    assert out["rows"][0]["device"] == "PC-01"


def test_export_writes_csv_and_audits():
    actor = StubSuperadminProvider().get_actor({})
    ll = _ll({"ORDER BY \"startTime\" DESC": [
        ("2026-08-24 12:00:00", "7", "zhangsan", "yunwei", "deepseek-v4-pro",
         100, 20, 120, 0.5, True, "PC-01", "10.0.0.9", "req-1")]})
    pg = _pg()
    out = handle_usage_export(dict(WINDOW), ll, pg, actor)
    assert out["rows"] == 1
    assert out["csv"].startswith("﻿")          # Excel 认 BOM,否则中文列名乱码
    assert "req-1" in out["csv"] and "张三" in out["csv"]
    assert pg.committed                              # 敏感读取必须落审计


def test_export_refuses_oversized_range():
    actor = StubSuperadminProvider().get_actor({})
    ll = _ll({"SELECT count(*)": [(999999,)]})
    with pytest.raises(NodeError):
        handle_usage_export(dict(WINDOW), ll, _pg(), actor)
