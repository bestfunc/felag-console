"""两个库的连接 helper。

本插件天生跨两个库,且**不能 join**:
- `platform_pg` → daily_report:users / departments(把归属里的 user_id 解析成姓名与部门)+ 本插件审计表。
- `litellm_pg`  → litellm:LiteLLM_SpendLogs(用量真相源)。

DSN 由平台凭据机制注入 `DB_<ALIAS 大写>_DSN` env。121/175 上两个库同属 dr-pg 实例,
但 psycopg2 一条连接只认一个库,所以仍是两条连接、结果在 Python 里 merge(见 nodes_impl)。
"""
from __future__ import annotations
import os
import psycopg2


def _connect(alias: str, env: str, hint: str):
    dsn = os.environ.get(env, "")
    if not dsn:
        raise RuntimeError(
            f"{env} 未注入 — 检查：① 凭据中心有 alias={alias} 的 database 凭据"
            f"(driver=postgres,{hint}) ② tinia-repo.yaml required_dbs 声明 ③ build ready ④ 凭据 verify 通过"
        )
    return psycopg2.connect(dsn)


def connect_platform() -> "psycopg2.extensions.connection":
    return _connect("platform_pg", "DB_PLATFORM_PG_DSN", "指向 daily_report")


def connect_litellm() -> "psycopg2.extensions.connection":
    return _connect("litellm_pg", "DB_LITELLM_PG_DSN", "指向 litellm 库")
