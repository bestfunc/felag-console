"""平台 PG 连接 helper。

DSN 由平台凭据机制注入：DB_PLATFORM_PG_DSN env，
形如 postgres://user:pwd@host:port/daily_report?sslmode=disable
（凭据中心建 type=database / driver=postgres / alias=platform_pg 的凭据，
tinia-repo.yaml required_dbs 声明；本期用平台超管 dr 账号 DSN）。psycopg2 可直接吃 postgres:// DSN。
"""
from __future__ import annotations
import os
import psycopg2

def connect_platform() -> "psycopg2.extensions.connection":
    dsn = os.environ.get("DB_PLATFORM_PG_DSN", "")
    if not dsn:
        raise RuntimeError(
            "DB_PLATFORM_PG_DSN 未注入 — 检查：① 凭据中心有 alias=platform_pg "
            "的 database 凭据(driver=postgres,指向 daily_report) ② tinia-repo.yaml required_dbs 声明 "
            "③ build ready ④ 凭据 verify 通过"
        )
    return psycopg2.connect(dsn)
