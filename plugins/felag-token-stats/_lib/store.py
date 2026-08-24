"""数据访问层:左手 litellm 库(用量真相源),右手平台库(把 user_id 解析成人)。
所有函数接收 conn、不 commit(节点层收口事务)。

## 两个必须记住的口径

**① 时间全是 UTC。** `LiteLLM_SpendLogs."startTime"` 是不带时区的 timestamp,存的是 UTC
(121/175 宿主机本身也跑在 UTC)。治理后台看的是北京时间,差 8 小时 —— 不换算的话"今天"会
从早上 8 点才开始算,当天上午的用量全被算进"昨天"。故所有筛选与按天分组都显式
`AT TIME ZONE 'UTC' AT TIME ZONE <tz>`,tz 由节点参数给(默认 Asia/Shanghai)。

**② 归属靠 server 注入的 spend_logs_metadata,不是 LiteLLM 的 user 列。**
felag-server 对所有数字员工共用同一把 master key,所以 LiteLLM 自己的 `user` 列恒为
`default_user_id`,分不出人。真正的归属是 felag-server 在 /llm/proxy 用
`X-Litellm-Spend-Logs-Metadata` 头注入、被 LiteLLM 落进 metadata->'spend_logs_metadata' 的那几个
felag_* 字段。**该头是 2026-08-24 才上线的**,更早的历史请求没有归属 → user_id 为空 →
统一归到「未归属」桶,而不是丢弃(丢弃会让总量对不上网关账单)。
"""
from __future__ import annotations

P = "plg_felagtoken_"

# 归属字段:server 注入的那份 JSON。历史数据没有 → NULL。
_META = "metadata->'spend_logs_metadata'"
_UID = f"{_META}->>'felag_user_id'"
_UNAME = f"{_META}->>'felag_username'"
_DEPT = f"{_META}->>'felag_dept'"
_DEVICE = f"{_META}->>'felag_device'"
_IP = f"{_META}->>'felag_ip'"

# 本地时间表达式:UTC 裸时间 → 目标时区的裸时间。
_LOCAL_TS = "(\"startTime\" AT TIME ZONE 'UTC' AT TIME ZONE %s)"

# group_by 白名单 → SQL 维度表达式。**只能走这张表**:维度直接拼进 SQL,
# 白名单外的值必须在这里被挡掉,否则就是注入口子。
GROUP_DIMENSIONS = {
    "employee": (_UID, "user_id"),
    "department": (_DEPT, "dept"),
    "model": ("model", "model"),
    "day": (f"to_char({_LOCAL_TS}, 'YYYY-MM-DD')", "day"),
}


def _window(params: dict):
    """把「本地日期 + 时区」翻成可直接和 startTime(UTC 裸时间)比较的边界。
    from/to 都是含端点的本地日历日:to 那天整天都算进来,故上界取 to+1 天。"""
    tz = params.get("tz") or "Asia/Shanghai"
    return params["from"], params["to"], tz


def _where(params: dict):
    """公共筛选:时间窗 + 可选 model / user_id。返回 (sql 片段, 参数列表)。"""
    d_from, d_to, tz = _window(params)
    sql = (
        " WHERE \"startTime\" >= (%s::date::timestamp AT TIME ZONE %s) AT TIME ZONE 'UTC'"
        "   AND \"startTime\" <  ((%s::date + 1)::timestamp AT TIME ZONE %s) AT TIME ZONE 'UTC'"
    )
    args = [d_from, tz, d_to, tz]
    if params.get("model"):
        sql += " AND model = %s"
        args.append(params["model"])
    if params.get("user_id"):
        sql += f" AND {_UID} = %s"
        args.append(str(params["user_id"]))
    return sql, args


_AGG = (
    "count(*) AS requests,"
    " coalesce(sum(prompt_tokens),0) AS prompt_tokens,"
    " coalesce(sum(completion_tokens),0) AS completion_tokens,"
    " coalesce(sum(total_tokens),0) AS total_tokens,"
    " coalesce(sum(spend),0) AS spend"
)
_AGG_KEYS = ["requests", "prompt_tokens", "completion_tokens", "total_tokens", "spend"]


def summary(conn, params: dict, group_by: str) -> list[dict]:
    """按一个维度聚合。group_by 必须是 GROUP_DIMENSIONS 的键(调用方已校验)。"""
    expr, key = GROUP_DIMENSIONS[group_by]
    where, args = _where(params)
    # day 维度的表达式自带一个 tz 占位符,且出现在 SELECT/GROUP BY 里 —— 参数顺序:先维度后 where。
    dim_args = [params.get("tz") or "Asia/Shanghai"] if group_by == "day" else []
    # 员工维度顺带把快照名/部门带出来(员工被删后平台库 join 不到时的兜底显示)。
    extra = f", max({_UNAME}) AS username, max({_DEPT}) AS dept" if group_by == "employee" else ""
    extra_keys = ["username", "dept"] if group_by == "employee" else []
    sql = f'SELECT {expr} AS k{extra}, {_AGG} FROM "LiteLLM_SpendLogs"{where} GROUP BY 1 ORDER BY 1'
    with conn.cursor() as cur:
        cur.execute(sql, dim_args + args)
        keys = ["key"] + extra_keys + _AGG_KEYS
        return [dict(zip(keys, r)) for r in cur.fetchall()]


def totals(conn, params: dict) -> dict:
    """整个筛选范围的总计(汇总卡)。"""
    where, args = _where(params)
    with conn.cursor() as cur:
        cur.execute(f'SELECT {_AGG} FROM "LiteLLM_SpendLogs"{where}', args)
        return dict(zip(_AGG_KEYS, cur.fetchone()))


_DETAIL_KEYS = ["ts", "user_id", "username", "dept", "model", "prompt_tokens",
                "completion_tokens", "total_tokens", "spend", "device", "ip", "request_id"]


def detail(conn, params: dict, limit: int, offset: int) -> list[dict]:
    """逐请求明细。**不含 prompt / 响应文本**(spec §9 R5:治理后台不展示员工请求内容),
    只有归属 + 用量 + 溯源用的 request_id。"""
    where, args = _where(params)
    tz = params.get("tz") or "Asia/Shanghai"
    sql = (
        f'SELECT to_char({_LOCAL_TS}, \'YYYY-MM-DD HH24:MI:SS\'), {_UID}, {_UNAME}, {_DEPT},'
        f' model, prompt_tokens, completion_tokens, total_tokens, spend, {_DEVICE}, {_IP}, request_id'
        f' FROM "LiteLLM_SpendLogs"{where} ORDER BY "startTime" DESC LIMIT %s OFFSET %s'
    )
    with conn.cursor() as cur:
        cur.execute(sql, [tz] + args + [limit, offset])
        return [dict(zip(_DETAIL_KEYS, r)) for r in cur.fetchall()]


def detail_count(conn, params: dict) -> int:
    where, args = _where(params)
    with conn.cursor() as cur:
        cur.execute(f'SELECT count(*) FROM "LiteLLM_SpendLogs"{where}', args)
        return cur.fetchone()[0]


def models(conn, params: dict) -> list[str]:
    """筛选范围内出现过的模型(给 UI 下拉)。"""
    where, args = _where({k: v for k, v in params.items() if k != "model"})
    with conn.cursor() as cur:
        cur.execute(f'SELECT DISTINCT model FROM "LiteLLM_SpendLogs"{where} ORDER BY 1', args)
        return [r[0] for r in cur.fetchall() if r[0]]


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
