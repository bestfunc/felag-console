import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
from bestfunc_sdk import Runtime
from _lib import db
from _lib.orgprovider import PlatformOrgProvider
from _lib.nodes_impl import handle_version_files

def main():
    rt = Runtime.from_stdin()
    conn = db.connect_platform()
    try:
        provider = PlatformOrgProvider(conn)
        out = handle_version_files(rt.params, conn, provider, provider.get_actor(rt.identity))
        rt.emit_output("result", out); rt.emit_done(out)
    except Exception as e:
        conn.rollback(); rt.emit_error(e)
    finally:
        conn.close()

if __name__ == "__main__":
    main()
