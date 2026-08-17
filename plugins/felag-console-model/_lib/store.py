"""配置 KV + 审计仓储。所有函数接收 conn、不 commit(节点层收口事务)。

本插件**没有模型表** —— 模型的真相源是网关(LiteLLM),这里只存连接配置和操作审计。
"""
import json

P = "plg_felagmodel_"

# 允许写入 config 的键白名单:防越权写任意 KV(与 felag-console-plugin 的 cred_keys 同思路)。
CONFIG_KEYS = ("felag_server_base", "felag_model_admin_token")

# 属于秘密的配置键:审计与回读一律不给值,只报"配没配"。
SECRET_KEYS = ("felag_model_admin_token",)


# felag-server 地址的默认值:与它同在 daily-report_dr-net 网络,容器名固定。
# 三级兜底的最后一级 —— 走到这里说明谁都没配过,而这个值在标准部署里就是对的。
DEFAULT_SERVER_BASE = "http://felag-server:28080"


def get_config(conn, k: str) -> str:
    with conn.cursor() as cur:
        cur.execute(f"SELECT v FROM {P}config WHERE k=%s", (k,))
        r = cur.fetchone()
        return r[0] if r else ""


def resolve_server_base(conn) -> str:
    """felag-server 地址三级兜底,正常情况下运维一个字都不用填:
      ① 本插件 config(有人显式配过就听他的)
      ② plg_felagapp_config.felag_server_base —— 客户端版本管理插件配过的同一个 felag-server
      ③ DEFAULT_SERVER_BASE 容器名默认值
    """
    if v := get_config(conn, "felag_server_base"):
        return v
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT v FROM plg_felagapp_config WHERE k='felag_server_base'")
            r = cur.fetchone()
            if r and r[0]:
                return r[0]
    except Exception:
        # 那个插件没装 → 表不存在(42P01)。这是正常情况,不是错误;
        # 但异常已让本事务进入 aborted 状态,必须回滚才能继续用这个连接。
        conn.rollback()
    return DEFAULT_SERVER_BASE


def resolve_token(conn) -> str:
    """服务令牌:由 felag-server 自举写入本表(见其 platform.EnsureModelAdminToken)。
    运维不用填 —— 取不到通常意味着 felag-server 还没跑到、或版本太老。"""
    return get_config(conn, "felag_model_admin_token")


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
