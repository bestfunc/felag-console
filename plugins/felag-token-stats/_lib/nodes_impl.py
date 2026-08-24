"""所有节点的业务逻辑纯函数。run.py 仅薄壳调用。

每个 handle 接收 (params, ll_conn, pg_conn, actor):`ll_conn` 是 litellm 库(用量真相源,**只读**),
`pg_conn` 是平台库(解析人 + 写审计)。跨两个库,所以「用量按 user_id 聚合」与「user_id → 姓名/部门」
是两次查询后在 Python 里 merge —— SQL join 跨不过库。

仅超管(spec §11)。非超管一律 fail-closed。
"""
from __future__ import annotations
import csv
import io

from _lib import store

_MAX_PAGE_SIZE = 200
_MAX_EXPORT_ROWS = 20000       # 导出上限:再多就不是"看一眼",该走数据库直查了
_UNATTRIBUTED = "未归属"


class NodeError(Exception):
    pass


def _require_super(actor):
    if not getattr(actor, "is_superadmin", False):
        raise NodeError("仅超管可查看 token 用量统计")


def _require_window(params) -> dict:
    """时间窗必填且必须成对 —— 不给默认「全部时间」:spend logs 只增不删,
    默认全量扫描会随部署时间越来越慢,且页面上看不出自己在看多大范围。"""
    d_from = (params.get("from") or "").strip()
    d_to = (params.get("to") or "").strip()
    if not d_from or not d_to:
        raise NodeError("from / to 必填(本地日历日,格式 YYYY-MM-DD,含首含尾)")
    if d_from > d_to:
        raise NodeError("from 不能晚于 to")
    out = {"from": d_from, "to": d_to, "tz": (params.get("tz") or "Asia/Shanghai")}
    if params.get("model"):
        out["model"] = str(params["model"])
    if params.get("user_id"):
        out["user_id"] = str(params["user_id"])
    return out


def _attach_identity(rows, pg_conn, key_field="key"):
    """给员工维度的行补上平台库里的权威姓名与部门。
    平台库查不到(员工已删)→ 回落 spend log 里的快照名;快照也没有(注入头上线前的历史请求)
    → 标「未归属」。三级兜底都要有,否则老数据会显示成一片空白行。"""
    ids = [str(r.get(key_field) or "") for r in rows]
    resolved = store.resolve_users(pg_conn, ids)
    for r in rows:
        uid = str(r.get(key_field) or "")
        info = resolved.get(uid)
        if info:
            r["display_name"] = info["display_name"]
            r["dept_name"] = info["dept_name"] or (r.get("dept") or "")
        else:
            r["display_name"] = r.get("username") or (f"#{uid}" if uid else _UNATTRIBUTED)
            r["dept_name"] = r.get("dept") or ""
    return rows


def _floats(rows):
    """psycopg2 把 numeric/double 的和给成 Decimal,json.dumps 吃不下 —— 统一转基本类型。"""
    for r in rows:
        for k in ("requests", "prompt_tokens", "completion_tokens", "total_tokens"):
            if k in r and r[k] is not None:
                r[k] = int(r[k])
        if r.get("cost") is not None:
            r["cost"] = float(r["cost"])
    return rows


def handle_usage_summary(params, ll_conn, pg_conn, actor) -> dict:
    """按维度聚合 + 总计 + 趋势(按天)一次返回 —— 页面一次加载就够,不用来回打三趟。"""
    _require_super(actor)
    p = _require_window(params)
    group_by = params.get("group_by") or "employee"
    if group_by not in store.GROUP_KEYS:
        raise NodeError(f"group_by 必须是 {' / '.join(store.GROUP_KEYS)} 之一")

    rows = _floats(store.summary(ll_conn, p, group_by))
    if group_by == "employee":
        _attach_identity(rows, pg_conn)
    else:
        for r in rows:
            r["display_name"] = r["key"] or _UNATTRIBUTED

    return {
        "group_by": group_by,
        "rows": rows,
        "totals": _floats([store.totals(ll_conn, p)])[0],
        "trend": _floats(store.summary(ll_conn, p, "day")),
        "models": store.models(ll_conn, p),
        # 没配单价的模型成本会算成 0 —— 页面要点名它们,否则"0 元"被当成"没花钱"。
        "unpriced_models": store.unpriced_models(ll_conn, p),
        "range": {"from": p["from"], "to": p["to"], "tz": p["tz"]},
    }


def handle_usage_detail(params, ll_conn, pg_conn, actor) -> dict:
    """逐请求明细,分页。不含请求文本(spec §9 R5)。"""
    _require_super(actor)
    p = _require_window(params)
    page = max(1, int(params.get("page") or 1))
    size = min(_MAX_PAGE_SIZE, max(1, int(params.get("page_size") or 50)))

    rows = _floats(store.detail(ll_conn, p, size, (page - 1) * size))
    _attach_identity(rows, pg_conn, key_field="user_id")
    return {
        "rows": rows,
        "page": page,
        "page_size": size,
        "total": store.detail_count(ll_conn, p),
        "range": {"from": p["from"], "to": p["to"], "tz": p["tz"]},
    }


_EXPORT_COLS = [
    ("ts", "时间"), ("display_name", "员工"), ("dept_name", "部门"), ("model", "模型"),
    ("prompt_tokens", "输入 token"), ("completion_tokens", "输出 token"), ("total_tokens", "总 token"),
    ("cost", "成本(元)"), ("peak", "高峰时段"), ("device", "设备"), ("ip", "IP"),
    ("request_id", "request_id"),
]


def handle_usage_export(params, ll_conn, pg_conn, actor) -> dict:
    """导出当前筛选范围的明细 CSV(不分页)。带出员工归属 + 设备 + IP,属敏感读取 → 落审计。
    CSV 以 UTF-8 BOM 开头,否则 Excel 打开中文列名是乱码。"""
    _require_super(actor)
    p = _require_window(params)

    total = store.detail_count(ll_conn, p)
    if total > _MAX_EXPORT_ROWS:
        raise NodeError(f"该范围有 {total} 条,超过单次导出上限 {_MAX_EXPORT_ROWS} 条,请缩小时间范围")

    rows = _floats(store.detail(ll_conn, p, _MAX_EXPORT_ROWS, 0))
    _attach_identity(rows, pg_conn, key_field="user_id")

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([label for _, label in _EXPORT_COLS])
    for r in rows:
        w.writerow([r.get(k, "") for k, _ in _EXPORT_COLS])

    store.add_audit(pg_conn, actor.name or actor.user_id, "export",
                    {"range": p, "rows": len(rows)})
    pg_conn.commit()

    return {"filename": f"token-usage-{p['from']}_{p['to']}.csv",
            "rows": len(rows),
            "csv": "﻿" + buf.getvalue()}
