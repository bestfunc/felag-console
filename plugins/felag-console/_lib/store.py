"""skills/versions/audit 仓储。所有函数接收 conn、不 commit（节点层事务收口）。"""
from __future__ import annotations
import json
from psycopg2.extras import RealDictCursor

P = "plg_felagskill_"

def _cur(conn):
    return conn.cursor(cursor_factory=RealDictCursor)

def _jsonable(rows):
    """把行里的 datetime/date（published_at/created_at/ts 等 TIMESTAMPTZ）转 isoformat 字符串，
    否则节点 emit 时 json.dumps 抛 'Object of type datetime is not JSON serializable'。"""
    return [{k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in r.items()} for r in rows]

def create_skill(conn, name, scope_ref, created_by) -> int:
    with conn.cursor() as cur:
        cur.execute(
            f"INSERT INTO {P}skills(name,scope_ref,created_by) VALUES(%s,%s,%s) RETURNING id",
            (name, scope_ref, created_by),
        )
        return cur.fetchone()[0]

def get_skill(conn, skill_id):
    with _cur(conn) as cur:
        cur.execute(f"SELECT * FROM {P}skills WHERE id=%s", (skill_id,))
        return cur.fetchone()

def get_active_skill_by_name(conn, name):
    with _cur(conn) as cur:
        cur.execute(f"SELECT * FROM {P}skills WHERE name=%s AND deleted_at IS NULL", (name,))
        return cur.fetchone()

def soft_delete_skill(conn, skill_id):
    with conn.cursor() as cur:
        cur.execute(f"UPDATE {P}skills SET deleted_at=now() WHERE id=%s", (skill_id,))

def set_status(conn, skill_id, status):
    with conn.cursor() as cur:
        cur.execute(f"UPDATE {P}skills SET status=%s WHERE id=%s", (status, skill_id))

def set_current_version(conn, skill_id, version_id):
    with conn.cursor() as cur:
        cur.execute(f"UPDATE {P}skills SET current_version_id=%s WHERE id=%s", (version_id, skill_id))

def list_skills_by_scopes(conn, scope_refs):
    if not scope_refs:
        return []
    with _cur(conn) as cur:
        cur.execute(
            f"SELECT * FROM {P}skills WHERE deleted_at IS NULL AND scope_ref = ANY(%s) ORDER BY name",
            (list(scope_refs),),
        )
        return cur.fetchall()

def list_all_active_skills(conn):
    with _cur(conn) as cur:
        cur.execute(f"SELECT * FROM {P}skills WHERE deleted_at IS NULL ORDER BY name")
        return cur.fetchall()

def add_version(conn, skill_id, version, content, sha256, uploaded_by) -> int:
    with conn.cursor() as cur:
        cur.execute(
            f"INSERT INTO {P}versions(skill_id,version,content,size_bytes,sha256,uploaded_by) "
            f"VALUES(%s,%s,%s,%s,%s,%s) RETURNING id",
            (skill_id, version, psycopg2_bytea(content), len(content), sha256, uploaded_by),
        )
        return cur.fetchone()[0]

def psycopg2_bytea(b: bytes):
    import psycopg2
    return psycopg2.Binary(b)

def finalize_package(conn, version_id, content, sha256):
    """审核通过时把暂存内容替换成最终分发包（tar.gz）并落 sha/大小。"""
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE {P}versions SET content=%s, size_bytes=%s, sha256=%s WHERE id=%s",
            (psycopg2_bytea(content), len(content), sha256, version_id),
        )

def get_version_content(conn, version_id):
    with conn.cursor() as cur:
        cur.execute(f"SELECT content FROM {P}versions WHERE id=%s", (version_id,))
        row = cur.fetchone()
    if not row:
        return None
    c = row[0]
    return c.tobytes() if isinstance(c, memoryview) else bytes(c)

def get_version(conn, version_id):
    with _cur(conn) as cur:
        cur.execute(
            f"SELECT id,skill_id,version,size_bytes,sha256,review_status,self_review,"
            f"uploaded_by,reviewed_by,published_at,created_at FROM {P}versions WHERE id=%s",
            (version_id,),
        )
        return cur.fetchone()

def list_versions(conn, skill_id):
    with _cur(conn) as cur:
        cur.execute(
            f"SELECT id,version,size_bytes,sha256,review_status,self_review,uploaded_by,"
            f"reviewed_by,published_at,created_at FROM {P}versions WHERE skill_id=%s ORDER BY id DESC",
            (skill_id,),
        )
        return _jsonable(cur.fetchall())

def review_version(conn, version_id, approve, reviewer, self_review) -> bool:
    new_status = "published" if approve else "rejected"
    with conn.cursor() as cur:
        if approve:
            cur.execute(
                f"UPDATE {P}versions SET review_status='published', reviewed_by=%s, "
                f"self_review=%s, published_at=now() "
                f"WHERE id=%s AND review_status='pending' RETURNING id",
                (reviewer, self_review, version_id),
            )
        else:
            cur.execute(
                f"UPDATE {P}versions SET review_status='rejected', reviewed_by=%s, self_review=%s "
                f"WHERE id=%s AND review_status='pending' RETURNING id",
                (reviewer, self_review, version_id),
            )
        return cur.fetchone() is not None

def delete_version(conn, version_id) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            f"DELETE FROM {P}versions WHERE id=%s AND review_status IN ('pending','rejected') RETURNING id",
            (version_id,),
        )
        return cur.fetchone() is not None

def add_audit(conn, actor, scope_ref, action, target, detail):
    with conn.cursor() as cur:
        cur.execute(
            f"INSERT INTO {P}audit(actor,scope_ref,action,target,detail) VALUES(%s,%s,%s,%s,%s)",
            (actor, scope_ref, action, target, json.dumps(detail or {})),
        )

# ---- uploads(client 用户上传的私有 skill 暂存区;felag-server 写、console 审核读)----
def list_pending_uploads(conn, scope_refs):
    """列待审上传:owner_dept_ref 落在调用者可管作用域内的。scope_refs 空 → 空列表(fail-closed)。
    owner_dept_ref 为 NULL(上传者未分配部门)的件不匹配任何 scope → 不出现在队列(见迁移注释,MVP 取舍)。"""
    if not scope_refs:
        return []
    with _cur(conn) as cur:
        cur.execute(
            f"SELECT id,owner_username,owner_dept_ref,name,version,size_bytes,sha256,description,created_at "
            f"FROM {P}uploads WHERE status='pending' AND owner_dept_ref = ANY(%s) ORDER BY id DESC",
            (list(scope_refs),),
        )
        return _jsonable(cur.fetchall())

def get_upload(conn, upload_id):
    with _cur(conn) as cur:
        cur.execute(
            f"SELECT id,owner_username,owner_dept_ref,name,version,size_bytes,sha256,"
            f"description,status,reviewer,reject_reason,published_skill_id,created_at,reviewed_at "
            f"FROM {P}uploads WHERE id=%s",
            (upload_id,),
        )
        return cur.fetchone()

def get_upload_content(conn, upload_id):
    with conn.cursor() as cur:
        cur.execute(f"SELECT content FROM {P}uploads WHERE id=%s", (upload_id,))
        row = cur.fetchone()
    if not row:
        return None
    c = row[0]
    return c.tobytes() if isinstance(c, memoryview) else bytes(c)

def mark_upload_reviewed(conn, upload_id, status, reviewer, reject_reason, published_skill_id) -> bool:
    """条件 UPDATE 防并发双处理:仅 pending 可流转。返回是否命中。"""
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE {P}uploads SET status=%s, reviewer=%s, reject_reason=%s, "
            f"published_skill_id=%s, reviewed_at=now() "
            f"WHERE id=%s AND status='pending' RETURNING id",
            (status, reviewer, reject_reason, published_skill_id, upload_id),
        )
        return cur.fetchone() is not None

def publish_version(conn, version_id, reviewer):
    """把一条已存在的 version 直接置为 published(供审核上传件时用;区别于 review_version 需 pending 前置)。"""
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE {P}versions SET review_status='published', reviewed_by=%s, published_at=now() "
            f"WHERE id=%s",
            (reviewer, version_id),
        )


def list_audit(conn, scope_refs, skill_id):
    if not scope_refs:
        return []
    clauses, args = ["scope_ref = ANY(%s)"], [list(scope_refs)]
    if skill_id is not None:
        clauses.append("target = %s")
        args.append(f"skill:{skill_id}")
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    with _cur(conn) as cur:
        cur.execute(f"SELECT id,actor,scope_ref,action,target,detail,ts FROM {P}audit{where} ORDER BY id DESC", args)
        return _jsonable(cur.fetchall())
