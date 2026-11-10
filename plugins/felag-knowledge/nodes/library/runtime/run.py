import json
import os
import urllib.error
import urllib.request
from contextlib import closing

import psycopg2
from bestfunc_sdk import Runtime


def handle(params, identity):
    actor = (identity or {}).get("user") or {}
    if not actor.get("is_superadmin") or not actor.get("id"):
        raise PermissionError("仅平台超管可维护知识库")
    with closing(psycopg2.connect(os.environ["DB_PLATFORM_PG_DSN"])) as conn, conn.cursor() as cur:
        cur.execute("SELECT k, v FROM plg_felagknowledge_config WHERE k IN ('server_base', 'token')")
        config = dict(cur.fetchall())
    token = config.get("token")
    if not token:
        raise RuntimeError("知识库治理服务正在初始化，请稍后刷新")
    base = config.get("server_base", "http://felag-server:28080").rstrip("/")
    req = urllib.request.Request(base + "/admin/knowledge", data=json.dumps({
        **params, "actor": int(actor["id"]),
    }).encode(), headers={"Content-Type": "application/json", "Authorization": "Bearer " + token})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(exc.read(1024).decode("utf-8", errors="replace").strip()) from exc
    except urllib.error.URLError as exc:
        raise RuntimeError("无法连接 Felag Server，请检查工作进程网络") from exc


if __name__ == "__main__":
    rt = Runtime.from_stdin()
    try:
        result = handle(rt.params, rt.identity)
        rt.emit_output("result", result)
        rt.emit_done(result)
    except Exception as exc:
        rt.emit_error(exc)
