"""store 层 SQL 口径断言。这里盯的是两个「看着对但错」的地方:
① 时区换算漏掉 → 北京时间上午的用量被算进前一天;
② 维度表达式直接拼进 SQL → 白名单必须是唯一入口。
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from _lib import store


class RecordingCursor:
    def __init__(self, sink):
        self.sink = sink

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, args=None):
        self.sink.append((sql, list(args or [])))

    def fetchall(self):
        return []

    def fetchone(self):
        return (0, 0, 0, 0, 0)


class RecordingConn:
    def __init__(self):
        self.calls = []

    def cursor(self):
        return RecordingCursor(self.calls)


W = {"from": "2026-08-01", "to": "2026-08-24", "tz": "Asia/Shanghai"}


def test_window_converts_local_days_to_utc_bounds():
    """spend logs 存 UTC 裸时间;筛选边界必须先在目标时区解释再转回 UTC,
    且上界是 to+1 天(to 当天整天都要算进来)。"""
    conn = RecordingConn()
    store.totals(conn, W)
    sql, args = conn.calls[0]
    assert "AT TIME ZONE 'UTC'" in sql and "AT TIME ZONE %s" in sql
    assert "(%s::date + 1)" in sql
    assert args == ["2026-08-01", "Asia/Shanghai", "2026-08-24", "Asia/Shanghai"]


def test_day_grouping_uses_local_calendar_day():
    conn = RecordingConn()
    store.summary(conn, W, "day")
    sql, args = conn.calls[0]
    assert "to_char" in sql
    # 维度表达式自带一个 tz 占位符,必须排在 where 的参数之前
    assert args[0] == "Asia/Shanghai"


def test_group_dimensions_are_a_closed_whitelist():
    assert set(store.GROUP_DIMENSIONS) == {"employee", "department", "model", "day"}


def test_attribution_comes_from_spend_logs_metadata_not_user_column():
    """归属只能读 server 注入的 spend_logs_metadata —— LiteLLM 自己的 user 列在共享
    master key 下恒为 default_user_id,一旦误用整页就会只有一个人。"""
    conn = RecordingConn()
    store.summary(conn, W, "employee")
    sql, _ = conn.calls[0]
    assert "spend_logs_metadata" in sql and "felag_user_id" in sql
    assert '"user"' not in sql


def test_detail_never_selects_request_or_response_text():
    """spec §9 R5:治理后台不展示员工的 prompt / 响应内容。"""
    conn = RecordingConn()
    store.detail(conn, W, 50, 0)
    sql, _ = conn.calls[0]
    for forbidden in ("messages", "response", "proxy_server_request"):
        assert forbidden not in sql
