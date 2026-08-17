"""配置 KV + 审计仓储。所有函数接收 conn、不 commit(节点层收口事务)。

本插件**没有模型表** —— 模型的真相源是网关(LiteLLM),这里只存连接配置和操作审计。
"""
import json

P = "plg_felagmodel_"

# 允许写入 config 的键白名单:防越权写任意 KV(与 felag-console-plugin 的 cred_keys 同思路)。
CONFIG_KEYS = ("felag_server_base", "felag_model_admin_token")

# 属于秘密的配置键:审计与回读一律不给值,只报"配没配"。
SECRET_KEYS = ("felag_model_admin_token",)


def get_config(conn, k: str) -> str:
    with conn.cursor() as cur:
        cur.execute(f"SELECT v FROM {P}config WHERE k=%s", (k,))
        r = cur.fetchone()
        return r[0] if r else ""


def set_config(conn, k: str, v: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            f"INSERT INTO {P}config (k, v) VALUES (%s,%s) "
            f"ON CONFLICT (k) DO UPDATE SET v=EXCLUDED.v", (k, v))


def config_view(conn) -> dict:
    """给 UI 看的配置视图:秘密项只回布尔,非秘密项回原值。"""
    out = {}
    for k in CONFIG_KEYS:
        v = get_config(conn, k)
        out[k] = bool(v) if k in SECRET_KEYS else v
    return out


def add_audit(conn, actor: str, action: str, target: str, detail: dict) -> None:
    with conn.cursor() as cur:
        cur.execute(
            f"INSERT INTO {P}audit (actor, action, target, detail) VALUES (%s,%s,%s,%s)",
            (actor, action, target, json.dumps(detail or {}, ensure_ascii=False)))


def list_audit(conn, limit: int = 200) -> list:
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT actor, action, target, detail, ts FROM {P}audit ORDER BY id DESC LIMIT %s", (limit,))
        keys = ["actor", "action", "target", "detail", "ts"]
        return [
            {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in zip(keys, r)}
            for r in cur.fetchall()
        ]
