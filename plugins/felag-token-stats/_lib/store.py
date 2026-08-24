"""数据访问层:左手 litellm 库(用量真相源),右手平台库(把 user_id 解析成人)。
所有函数接收 conn、不 commit(节点层收口事务)。

## 三个必须记住的口径

**① 时间全是 UTC。** `LiteLLM_SpendLogs."startTime"` 是不带时区的 timestamp,存的是 UTC
(121/175 宿主机本身也跑在 UTC)。治理后台看的是北京时间,差 8 小时 —— 不换算的话"今天"会
从早上 8 点才开始算,当天上午的用量全被算进"昨天"。故所有筛选、按天分组、以及高峰/空闲时段
判定都换算到目标时区(默认 Asia/Shanghai)。

**② 归属靠 server 注入的 spend_logs_metadata,不是 LiteLLM 的 user 列。**
felag-server 对所有数字员工共用同一把 master key,所以 LiteLLM 自己的 `user` 列恒为
`default_user_id`,分不出人。真正的归属是 felag-server 在 /llm/proxy 用
`X-Litellm-Spend-Logs-Metadata` 头注入、被 LiteLLM 落进 metadata->'spend_logs_metadata' 的那几个
felag_* 字段。**该头是 2026-08-24 才上线的**,更早的历史请求没有归属 → user_id 为空 →
统一归到「未归属」桶,而不是丢弃(丢弃会让总量对不上网关账单)。

**③ 成本不读 spend 列,按单价现算。** 网关三个模型的单价全是 0,`spend` 恒为 0。计价规则见
`pricing.py`。

## 时区为什么是内联而不是占位符

成本表达式里的高峰时段判定要用到三次本地时刻,时区若走 `%s` 就会凭空多出一批占位符,
参数顺序稍错就是"看着对但错"的数。故时区经白名单校验后内联进 SQL —— 值域受控,不是注入面。
"""
from __future__ import annotations
import re

from _lib import pricing

P = "plg_felagtoken_"

# 归属字段:server 注入的那份 JSON。历史数据没有 → NULL。
_META = "metadata->'spend_logs_metadata'"
_UID = f"{_META}->>'felag_user_id'"
_UNAME = f"{_META}->>'felag_username'"
_DEPT = f"{_META}->>'felag_dept'"
_DEVICE = f"{_META}->>'felag_device'"
_IP = f"{_META}->>'felag_ip'"

# 时区名白名单:IANA 名字只会用到这几类字符。挡住一切拼进 SQL 的花样。
_TZ_RE = re.compile(r"^[A-Za-z0-9_+/-]{1,64}$")

# 可聚合的维度。**只能走这张表** —— 维度直接拼进 SQL,白名单外的值必须在这里被挡掉。
GROUP_KEYS = ("employee", "department", "model", "day")


def _tz(params: dict) -> str:
    tz = (params.get("tz") or "Asia/Shanghai").strip()
    if not _TZ_RE.match(tz):
        raise ValueError(f"非法时区名: {tz!r}")
    return tz


def _local_ts(tz: str) -> str:
    """UTC 裸时间 → 目标时区的裸时间。"""
    return f"(\"startTime\" AT TIME ZONE 'UTC' AT TIME ZONE '{tz}')"


def _dimension(group_by: str, tz: str) -> str:
    """维度表达式。调用方须先用 GROUP_KEYS 校验过 group_by。"""
    return {
        "employee": _UID,
        "department": _DEPT,
        "model": "model",
        "day": f"to_char({_local_ts(tz)}, 'YYYY-MM-DD')",
    }[group_by]


def _where(params: dict, tz: str):
    """公共筛选:时间窗 + 可选 model / user_id。返回 (sql 片段, 参数列表)。
    from/to 都是含端点的本地日历日:to 那天整天都算进来,故上界取 to+1 天。"""
    sql = (
        f" WHERE \"startTime\" >= (%s::date::timestamp AT TIME ZONE '{tz}') AT TIME ZONE 'UTC'"
        f"   AND \"startTime\" <  ((%s::date + 1)::timestamp AT TIME ZONE '{tz}') AT TIME ZONE 'UTC'"
    )
    args = [params["from"], params["to"]]
    if params.get("model"):
        sql += " AND model = %s"
        args.append(params["model"])
    if params.get("user_id"):
        sql += f" AND {_UID} = %s"
        args.append(str(params["user_id"]))
    return sql, args


def _agg(tz: str) -> str:
    return (
        "count(*) AS requests,"
        " coalesce(sum(prompt_tokens),0) AS prompt_tokens,"
        " coalesce(sum(completion_tokens),0) AS completion_tokens,"
        " coalesce(sum(total_tokens),0) AS total_tokens,"
        f" coalesce(sum({pricing.cost_expr(_local_ts(tz))}),0) AS cost"
    )


_AGG_KEYS = ["requests", "prompt_tokens", "completion_tokens", "total_tokens", "cost"]


def summary(conn, params: dict, group_by: str) -> list[dict]:
    """按一个维度聚合。group_by 必须属于 GROUP_KEYS(调用方已校验)。"""
    tz = _tz(params)
    expr = _dimension(group_by, tz)
    where, args = _where(params, tz)
    # 员工维度顺带把快照名/部门带出来(员工被删后平台库 join 不到时的兜底显示)。
    extra = f", max({_UNAME}) AS username, max({_DEPT}) AS dept" if group_by == "employee" else ""
    extra_keys = ["username", "dept"] if group_by == "employee" else []
    sql = f'SELECT {expr} AS k{extra}, {_agg(tz)} FROM "LiteLLM_SpendLogs"{where} GROUP BY 1 ORDER BY 1'
    with conn.cursor() as cur:
        cur.execute(sql, args)
        keys = ["key"] + extra_keys + _AGG_KEYS
        return [dict(zip(keys, r)) for r in cur.fetchall()]


def totals(conn, params: dict) -> dict:
    """整个筛选范围的总计(汇总卡)。"""
    tz = _tz(params)
    where, args = _where(params, tz)
    with conn.cursor() as cur:
        cur.execute(f'SELECT {_agg(tz)} FROM "LiteLLM_SpendLogs"{where}', args)
        return dict(zip(_AGG_KEYS, cur.fetchone()))


_DETAIL_KEYS = ["ts", "user_id", "username", "dept", "model", "prompt_tokens",
                "completion_tokens", "total_tokens", "cost", "peak", "device", "ip", "request_id"]


def detail(conn, params: dict, limit: int, offset: int) -> list[dict]:
    """逐请求明细。**不含 prompt / 响应文本**(spec §9 R5:治理后台不展示员工请求内容),
    只有归属 + 用量 + 溯源用的 request_id。peak 标出该请求是否落在高峰时段(计价差一倍)。"""
    tz = _tz(params)
    lts = _local_ts(tz)
    where, args = _where(params, tz)
    sql = (
        f"SELECT to_char({lts}, 'YYYY-MM-DD HH24:MI:SS'), {_UID}, {_UNAME}, {_DEPT},"
        f" model, prompt_tokens, completion_tokens, total_tokens,"
        f" {pricing.cost_expr(lts)},"
        f" {pricing.peak_flag_expr(lts)},"
        f" {_DEVICE}, {_IP}, request_id"
        f' FROM "LiteLLM_SpendLogs"{where} ORDER BY "startTime" DESC LIMIT %s OFFSET %s'
    )
    with conn.cursor() as cur:
        cur.execute(sql, args + [limit, offset])
        return [dict(zip(_DETAIL_KEYS, r)) for r in cur.fetchall()]


def detail_count(conn, params: dict) -> int:
    tz = _tz(params)
    where, args = _where(params, tz)
    with conn.cursor() as cur:
        cur.execute(f'SELECT count(*) FROM "LiteLLM_SpendLogs"{where}', args)
        return cur.fetchone()[0]


def models(conn, params: dict) -> list[str]:
    """筛选范围内出现过的模型(给 UI 下拉)。"""
    tz = _tz(params)
    where, args = _where({k: v for k, v in params.items() if k != "model"}, tz)
    with conn.cursor() as cur:
        cur.execute(f'SELECT DISTINCT model FROM "LiteLLM_SpendLogs"{where} ORDER BY 1', args)
        return [r[0] for r in cur.fetchall() if r[0]]


def unpriced_models(conn, params: dict) -> list[str]:
    """出现过但没配单价的模型 —— 它们的成本会算成 0,得在页面上说清楚,
    不然"0 元"会被当成"没花钱"。"""
    known = set(pricing.priced_models())
    return [m for m in models(conn, params) if m.rsplit("/", 1)[-1] not in known]


# ── 平台库侧:user_id → 人 ───────────────────────────────────────────────

def resolve_users(conn, user_ids: list[str]) -> dict[str, dict]:
    """把归属里的 user_id 解析成 {display_name, dept_name}(权威值,随平台改名而变)。
    已被删除的员工在这里查不到 —— 调用方用 spend log 里的快照名兜底。"""
    ids = [int(u) for u in user_ids if str(u).isdigit()]
    if not ids:
        return {}
    with conn.cursor() as cur:
        cur.execute(
            "SELECT u.id, coalesce(nullif(u.display_name,''), u.username), coalesce(d.name,'')"
            " FROM users u LEFT JOIN departments d ON d.id = u.dept_id"
            " WHERE u.id = ANY(%s)", (ids,))
        return {str(r[0]): {"display_name": r[1], "dept_name": r[2]} for r in cur.fetchall()}


def add_audit(conn, actor: str, action: str, detail_json) -> None:
    import json
    with conn.cursor() as cur:
        cur.execute(f"INSERT INTO {P}audit (actor, action, detail) VALUES (%s,%s,%s)",
                    (actor, action, json.dumps(detail_json, ensure_ascii=False)))
