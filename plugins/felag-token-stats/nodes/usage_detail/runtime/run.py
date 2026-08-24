import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
from bestfunc_sdk import Runtime
from _lib import db
from _lib.provider import PlatformSuperadminProvider
from _lib.nodes_impl import handle_usage_detail

def main():
    rt = Runtime.from_stdin()
    ll = db.connect_litellm()
    pg = db.connect_platform()
    try:
        provider = PlatformSuperadminProvider()
        out = handle_usage_detail(rt.params, ll, pg, provider.get_actor(rt.identity))
        rt.emit_output("result", out); rt.emit_done(out)
    except Exception as e:
        rt.emit_error(e)
    finally:
        ll.close(); pg.close()

if __name__ == "__main__":
    main()
