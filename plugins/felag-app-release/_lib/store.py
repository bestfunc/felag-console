"""客户端发布(releases)仓储:CRUD + 按平台切当前版 + 审计 + KV 配置读。
所有函数接收 conn、不 commit(节点层收口事务)。"""
import json

P = "plg_felagapp_"

_COLS = "id, version, platform, notes, filename, sha256, size, uploaded_by, created_at, is_current"
_KEYS = ["id", "version", "platform", "notes", "filename", "sha256", "size", "uploaded_by", "created_at", "is_current"]

def _jsonify(d):
    """把行里的 datetime(created_at TIMESTAMPTZ)转 isoformat,否则节点 emit 时 json.dumps 抛错。"""
    return {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in d.items()}

def _row(r):
    if r is None:
        return None
    return _jsonify(dict(zip(_KEYS, r)))

def list_all(conn):
    """全部发布,按平台 + 时间倒序(前端按平台分组)。客户端版本全局,无 scope 过滤。"""
    with conn.cursor() as cur:
        cur.execute(f"SELECT {_COLS} FROM {P}releases ORDER BY platform, created_at DESC, id DESC")
        return [_row(r) for r in cur.fetchall()]

def get(conn, release_id):
    with conn.cursor() as cur:
        cur.execute(f"SELECT {_COLS} FROM {P}releases WHERE id=%s", (release_id,))
        return _row(cur.fetchone())

def insert_draft(conn, version, platform, notes, filename, sha256, size, uploaded_by) -> int:
    """插入一条已上传未发布(is_current=false)的记录。(version,platform) 唯一,冲突抛 UniqueViolation。"""
    with conn.cursor() as cur:
        cur.execute(
            f"INSERT INTO {P}releases (version, platform, notes, filename, sha256, size, uploaded_by, is_current) "
            f"VALUES (%s,%s,%s,%s,%s,%s,%s,false) RETURNING id",
            (version, platform, notes, filename, sha256, size, uploaded_by))
        return cur.fetchone()[0]

def set_current(conn, release_id, platform) -> bool:
    """把 release_id 置为该 platform 的当前版:先清同平台旧 current,再置新。
    先清后置保证 partial unique index (platform) WHERE is_current 不冲突。返回目标行是否存在。"""
    with conn.cursor() as cur:
        cur.execute(f"UPDATE {P}releases SET is_current=false WHERE is_current AND platform=%s", (platform,))
        cur.execute(f"UPDATE {P}releases SET is_current=true WHERE id=%s RETURNING id", (release_id,))
        return cur.fetchone() is not None

def delete(conn, release_id) -> bool:
    """删元数据行。仅非当前版可删(is_current 由节点层先判)。返回是否命中。"""
    with conn.cursor() as cur:
        cur.execute(f"DELETE FROM {P}releases WHERE id=%s AND NOT is_current RETURNING id", (release_id,))
        return cur.fetchone() is not None

def get_config(conn, key) -> str:
    """读插件 KV 配置(felag_server_base / felag_app_upload_token);未配 → 空串。"""
    with conn.cursor() as cur:
        cur.execute(f"SELECT v FROM {P}config WHERE k=%s", (key,))
        row = cur.fetchone()
        return (row[0] or "").strip() if row else ""

def add_audit(conn, actor, action, target, detail):
    with conn.cursor() as cur:
        cur.execute(
            f"INSERT INTO {P}audit (actor, action, target, detail) VALUES (%s,%s,%s,%s)",
            (actor, action, target, json.dumps(detail)))
