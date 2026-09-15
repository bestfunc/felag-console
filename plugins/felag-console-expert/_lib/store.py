"""专家表的 SQL 层。表前缀由平台按 tinia-repo.yaml 的 table_prefix 固定为 plg_felagexpert_。"""
from __future__ import annotations

T = "plg_felagexpert_experts"
A = "plg_felagexpert_audit"

# 列表页要的列(不含 body —— 正文动辄几 KB,列表里没人看,白白撑大响应)
LIST_COLS = "id, name, scope_ref, display_name, profession, description, version, avatar, status, reject_reason, created_by, reviewed_by, updated_at"


def _rows(cur) -> list:
    """出库行 → dict，并把 datetime/date 转成 isoformat 字符串。

    不转的话节点 emit 时 json.dumps 会抛
    'Object of type datetime is not JSON serializable' —— 而且抱得很晚：
    写入已经成功提交了，只是返回的那一步挂，看起来像「保存失败」。
    所有出库路径（list / get / get_by_name / list_audit）都走这里，收在一处。
    """
    cols = [d[0] for d in cur.description]
    return [
        {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in zip(cols, r)}
        for r in cur.fetchall()
    ]


def list_by_scopes(conn, scopes, super_admin: bool) -> list:
    with conn.cursor() as cur:
        if super_admin:
            cur.execute(f"SELECT {LIST_COLS} FROM {T} WHERE deleted_at IS NULL ORDER BY updated_at DESC")
        else:
            if not scopes:
                return []
            cur.execute(
                f"SELECT {LIST_COLS} FROM {T} WHERE deleted_at IS NULL AND scope_ref = ANY(%s) ORDER BY updated_at DESC",
                (list(scopes),),
            )
        return _rows(cur)


def get(conn, expert_id: int) -> "dict | None":
    with conn.cursor() as cur:
        cur.execute(f"SELECT {LIST_COLS}, body FROM {T} WHERE id=%s AND deleted_at IS NULL", (expert_id,))
        rows = _rows(cur)
        return rows[0] if rows else None


def get_by_name(conn, name: str) -> "dict | None":
    with conn.cursor() as cur:
        cur.execute(f"SELECT {LIST_COLS}, body FROM {T} WHERE name=%s AND deleted_at IS NULL", (name,))
        rows = _rows(cur)
        return rows[0] if rows else None


def insert(conn, *, name, scope_ref, display_name, profession, description,
           version, avatar, body, sha256, created_by) -> int:
    with conn.cursor() as cur:
        cur.execute(
            f"""INSERT INTO {T}
                (name, scope_ref, display_name, profession, description, version, avatar,
                 body, sha256, status, created_by)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'pending',%s) RETURNING id""",
            (name, scope_ref, display_name, profession, description, version, avatar,
             body, sha256, created_by),
        )
        return cur.fetchone()[0]


def update(conn, expert_id: int, *, scope_ref, display_name, profession, description,
           version, avatar, body, sha256) -> None:
    """改内容一律把状态打回 pending —— 已发布的专家被改了正文却还挂着 published,
    等于用一次通过的审核放行了没审过的内容。"""
    with conn.cursor() as cur:
        cur.execute(
            f"""UPDATE {T} SET scope_ref=%s, display_name=%s, profession=%s, description=%s,
                   version=%s, avatar=%s, body=%s, sha256=%s,
                   status='pending', reject_reason=NULL, updated_at=now()
                 WHERE id=%s AND deleted_at IS NULL""",
            (scope_ref, display_name, profession, description, version, avatar, body, sha256, expert_id),
        )


def set_status(conn, expert_id: int, status: str, reviewer: str, reason: "str | None" = None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            f"""UPDATE {T} SET status=%s, reviewed_by=%s, reject_reason=%s,
                   published_at = CASE WHEN %s='published' THEN now() ELSE published_at END,
                   updated_at=now()
                 WHERE id=%s AND deleted_at IS NULL""",
            (status, reviewer, reason, status, expert_id),
        )


def audit(conn, actor: str, scope_ref: str, action: str, target: str, detail: dict) -> None:
    import json
    with conn.cursor() as cur:
        cur.execute(
            f"INSERT INTO {A} (actor, scope_ref, action, target, detail) VALUES (%s,%s,%s,%s,%s)",
            (actor, scope_ref, action, target, json.dumps(detail, ensure_ascii=False)),
        )


def list_audit(conn, limit: int = 100) -> list:
    with conn.cursor() as cur:
        cur.execute(f"SELECT actor, scope_ref, action, target, detail, ts FROM {A} ORDER BY id DESC LIMIT %s", (limit,))
        return _rows(cur)
