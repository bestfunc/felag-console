import json
import os
import sys
import urllib.error
import urllib.request
from contextlib import closing

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
from bestfunc_sdk import Runtime
from _lib import db
from _lib.provider import PlatformSuperadminProvider


def handle_billing(params, identity):
    actor = PlatformSuperadminProvider().get_actor(identity)
    if not actor.is_superadmin or not actor.user_id:
        raise PermissionError("仅超管可操作公司额度与费率")
    with closing(db.connect_platform()) as conn, conn.cursor() as cur:
        cur.execute("SELECT k,v FROM plg_felagtoken_billing_config WHERE k IN ('server_base','token')")
        config = dict(cur.fetchall())
    token = config.get("token")
    if not token:
        raise RuntimeError("Felag Server 的计费治理令牌尚未就绪")
    base = config.get("server_base", "http://felag-server:28080").rstrip("/")
    payload = {**params, "actor": int(actor.user_id)}
    req = urllib.request.Request(base + "/admin/billing", data=json.dumps(payload).encode(), headers={
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token,
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(exc.read(1024).decode("utf-8", errors="replace").strip()) from exc


def main():
    rt = Runtime.from_stdin()
    try:
        out = handle_billing(rt.params, rt.identity)
        rt.emit_output("result", out)
        rt.emit_done(out)
    except Exception as exc:
        rt.emit_error(exc)


if __name__ == "__main__":
    main()
