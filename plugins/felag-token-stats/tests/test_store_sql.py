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
    assert "AT TIME ZONE 'UTC'" in sql and "AT TIME ZONE 'Asia/Shanghai'" in sql
    assert "(%s::date + 1)" in sql
    # 时区是内联的(成本表达式要用它三次,走占位符会让参数顺序变得极易错位),
    # 所以参数里只剩日期边界。
    assert args == ["2026-08-01", "2026-08-24"]


def test_day_grouping_uses_local_calendar_day():
    conn = RecordingConn()
    store.summary(conn, W, "day")
    sql, args = conn.calls[0]
    assert "to_char" in sql
    assert "AT TIME ZONE 'Asia/Shanghai'" in sql
    assert args == ["2026-08-01", "2026-08-24"]


def test_illegal_timezone_is_rejected():
    """时区内联进 SQL,值域必须锁死 —— 否则它就是个注入口子。"""
    import pytest
    conn = RecordingConn()
    with pytest.raises(ValueError):
        store.totals(conn, {**W, "tz": "Asia/Shanghai'; DROP TABLE x --"})


def test_cost_is_computed_not_read_from_spend_column():
    """网关三个模型单价全是 0,spend 列恒为 0 —— 读它只会得到"一分钱没花"。"""
    conn = RecordingConn()
    store.totals(conn, W)
    sql, _ = conn.calls[0]
    assert "sum(spend)" not in sql
    assert "prompt_tokens *" in sql and "completion_tokens *" in sql


def test_peak_hours_match_the_agreed_window():
    """高峰 = 工作日 9-12、14-18(北京时间),其余含周末减半。写错时段就是静默算错一倍钱。"""
    conn = RecordingConn()
    store.totals(conn, W)
    sql, _ = conn.calls[0]
    assert "isodow" in sql and "<= 5" in sql
    assert "'09:00'" in sql and "'12:00'" in sql
    assert "'14:00'" in sql and "'18:00'" in sql
    assert "ELSE 0.5" in sql


def test_group_dimensions_are_a_closed_whitelist():
    assert set(store.GROUP_KEYS) == {"employee", "department", "model", "day"}


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
