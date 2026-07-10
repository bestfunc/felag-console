"""插件源(sources)仓储:CRUD + CAS 审核(draft→approved→deprecated)+ 审计。所有函数接收 conn、不 commit(节点层事务收口)。"""
import json

P = "plg_felagplugin_"

def _cols():
    return "id, git_url, plugin, scope_ref, branch, status, created_by, reviewed_by, created_at, reviewed_at"

def _jsonify(d):
    """把行里的 datetime/date(created_at/reviewed_at 等 TIMESTAMPTZ)转 isoformat 字符串,
    否则节点 emit 时 json.dumps 抛 'Object of type datetime is not JSON serializable'。"""
    return {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in d.items()}

def _row(r):
    if r is None:
        return None
    k = ["id", "git_url", "plugin", "scope_ref", "branch", "status", "created_by", "reviewed_by", "created_at", "reviewed_at"]
    return _jsonify(dict(zip(k, r)))

def create_source(conn, git_url, plugin, scope_ref, created_by, branch="main") -> int:
    with conn.cursor() as cur:
        cur.execute(
            f"INSERT INTO {P}sources (git_url, plugin, scope_ref, branch, created_by) VALUES (%s,%s,%s,%s,%s) RETURNING id",
            (git_url, plugin, scope_ref, branch or "main", created_by))
        sid = cur.fetchone()[0]
    return sid

def get_source(conn, source_id):
    with conn.cursor() as cur:
        cur.execute(f"SELECT {_cols()} FROM {P}sources WHERE id=%s", (source_id,))
        return _row(cur.fetchone())

def list_sources_by_scopes(conn, scope_refs, status=None):
    with conn.cursor() as cur:
        q = f"SELECT {_cols()} FROM {P}sources WHERE scope_ref = ANY(%s)"
        args = [list(scope_refs)]
        if status:
            q += " AND status=%s"; args.append(status)
        q += " ORDER BY id DESC"
        cur.execute(q, args)
        return [_row(r) for r in cur.fetchall()]

def list_approved_sources(conn):
    with conn.cursor() as cur:
        cur.execute(f"SELECT {_cols()} FROM {P}sources WHERE status='approved' ORDER BY id")
        return [_row(r) for r in cur.fetchall()]

def review_source(conn, source_id, reviewer) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE {P}sources SET status='approved', reviewed_by=%s, reviewed_at=now() "
            f"WHERE id=%s AND status='draft' RETURNING id", (reviewer, source_id))
        ok = cur.fetchone() is not None
    return ok

def deprecate_source(conn, source_id, reviewer) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE {P}sources SET status='deprecated', reviewed_by=%s, reviewed_at=now() "
            f"WHERE id=%s AND status='approved' RETURNING id", (reviewer, source_id))
        ok = cur.fetchone() is not None
    return ok

def delete_source(conn, source_id) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            f"DELETE FROM {P}sources WHERE id=%s AND status IN ('draft','deprecated') RETURNING id", (source_id,))
        ok = cur.fetchone() is not None
    return ok

def add_audit(conn, actor, scope_ref, action, target, detail):
    with conn.cursor() as cur:
        cur.execute(
            f"INSERT INTO {P}audit (actor, scope_ref, action, target, detail) VALUES (%s,%s,%s,%s,%s)",
            (actor, scope_ref, action, target, json.dumps(detail)))
