"""插件源(sources)仓储:CRUD + CAS 审核(draft→approved→deprecated)+ 审计。所有函数接收 conn、不 commit(节点层事务收口)。"""
import json

P = "plg_felagplugin_"

def _cols():
    return "id, git_url, plugin, display_name, scope_ref, branch, status, created_by, reviewed_by, created_at, reviewed_at, sync_requested_at, git_version"

def _jsonify(d):
    """把行里的 datetime/date(created_at/reviewed_at 等 TIMESTAMPTZ)转 isoformat 字符串,
    否则节点 emit 时 json.dumps 抛 'Object of type datetime is not JSON serializable'。"""
    return {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in d.items()}

def _row(r):
    if r is None:
        return None
    k = ["id", "git_url", "plugin", "display_name", "scope_ref", "branch", "status", "created_by", "reviewed_by", "created_at", "reviewed_at", "sync_requested_at", "git_version"]
    return _jsonify(dict(zip(k, r)))

def create_source(conn, git_url, plugin, scope_ref, created_by, branch="main", display_name=None, kind="git") -> int:
    with conn.cursor() as cur:
        cur.execute(
            f"INSERT INTO {P}sources (git_url, plugin, display_name, scope_ref, branch, created_by, kind) VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id",
            (git_url, plugin, (display_name or None), scope_ref, branch or "main", created_by, kind))
        sid = cur.fetchone()[0]
    return sid


def official_enabled_scopes(conn, git_url, plugin, branch, scope_refs):
    """返回给定 scope_refs 中,已存在 approved 官方源(该 git/plugin/branch)的 scope 集合。用于 official_list 展示启停态。"""
    if not scope_refs:
        return set()
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT scope_ref FROM {P}sources "
            f"WHERE kind='official' AND git_url=%s AND plugin=%s AND branch=%s AND status='approved' AND scope_ref = ANY(%s)",
            (git_url, plugin, branch or "main", list(scope_refs)))
        return {r[0] for r in cur.fetchall()}


def find_official_source(conn, git_url, plugin, branch, scope_ref):
    """按 (git,plugin,branch,scope) 定位官方源行(任意状态);不存在 → None。"""
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT {_cols()} FROM {P}sources "
            f"WHERE kind='official' AND git_url=%s AND plugin=%s AND branch=%s AND scope_ref=%s",
            (git_url, plugin, branch or "main", scope_ref))
        return _row(cur.fetchone())


def enable_official(conn, git_url, plugin, branch, scope_ref, display_name, actor) -> int:
    """启用官方插件(某 scope):upsert 一条 kind='official' status='approved' 源(幂等,官方免人工审核)。
    冲突键 (git_url,plugin,scope_ref,branch);重复启用/曾停用 → 复位 approved。返回源 id。不 commit。"""
    with conn.cursor() as cur:
        cur.execute(
            f"INSERT INTO {P}sources (git_url, plugin, display_name, scope_ref, branch, kind, status, created_by, reviewed_by, reviewed_at) "
            f"VALUES (%s,%s,%s,%s,%s,'official','approved',%s,%s,now()) "
            f"ON CONFLICT (git_url, plugin, scope_ref, branch) DO UPDATE SET "
            f"status='approved', kind='official', reviewed_by=%s, reviewed_at=now() RETURNING id",
            (git_url, plugin, (display_name or None), scope_ref, branch or "main", actor, actor, actor))
        return cur.fetchone()[0]


def disable_official(conn, git_url, plugin, branch, scope_ref, actor) -> bool:
    """停用官方插件(某 scope):approved→deprecated(felag-server PruneExcept 卸载)。命中返回 True。不 commit。"""
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE {P}sources SET status='deprecated', reviewed_by=%s, reviewed_at=now() "
            f"WHERE kind='official' AND git_url=%s AND plugin=%s AND branch=%s AND scope_ref=%s AND status='approved' RETURNING id",
            (actor, git_url, plugin, branch or "main", scope_ref))
        return cur.fetchone() is not None


def get_config(conn, keys):
    """读 plg_felagplugin_config 若干 KV,返回 {k:v}(未命中的 key 不在结果里)。"""
    if not keys:
        return {}
    with conn.cursor() as cur:
        cur.execute(f"SELECT k, v FROM {P}config WHERE k = ANY(%s)", (list(keys),))
        return {k: v for k, v in cur.fetchall()}


def set_config(conn, k, v):
    """upsert 一条 plg_felagplugin_config KV(如飞书 lark_app_id/secret)。不 commit(节点层收口)。"""
    with conn.cursor() as cur:
        cur.execute(
            f"INSERT INTO {P}config (k, v) VALUES (%s,%s) ON CONFLICT (k) DO UPDATE SET v=EXCLUDED.v",
            (k, v))

def get_source(conn, source_id):
    with conn.cursor() as cur:
        cur.execute(f"SELECT {_cols()} FROM {P}sources WHERE id=%s", (source_id,))
        return _row(cur.fetchone())

def list_sources_by_scopes(conn, scope_refs, status=None):
    # 只列第三方录入源(kind='git'/NULL);官方插件走 official_list,不混进第三方表。
    with conn.cursor() as cur:
        q = f"SELECT {_cols()} FROM {P}sources WHERE scope_ref = ANY(%s) AND (kind IS NULL OR kind <> 'official')"
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

def set_display_name(conn, source_id, display_name) -> bool:
    """只改展示名(空串归一为 NULL,下游回退用包名),不动其它任何列。返回是否命中。不 commit(节点层收口)。"""
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE {P}sources SET display_name=%s WHERE id=%s RETURNING id",
            ((display_name or None), source_id))
        return cur.fetchone() is not None

def request_sync(conn, source_id) -> bool:
    """置 sync_requested_at=now(),仅对 approved 源生效(felag-server 只摄 approved)。
    返回是否命中(非 approved / 不存在 → False)。不 commit(节点层收口)。"""
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE {P}sources SET sync_requested_at=now() WHERE id=%s AND status='approved' RETURNING id",
            (source_id,))
        return cur.fetchone() is not None

def add_audit(conn, actor, scope_ref, action, target, detail):
    with conn.cursor() as cur:
        cur.execute(
            f"INSERT INTO {P}audit (actor, scope_ref, action, target, detail) VALUES (%s,%s,%s,%s,%s)",
            (actor, scope_ref, action, target, json.dumps(detail)))
