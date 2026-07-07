import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
from bestfunc_sdk import Runtime
from _lib.nodes_impl import handle_plugin_discover

def main():
    rt = Runtime.from_stdin()
    try:
        out = handle_plugin_discover(rt.params)   # 纯拉取枚举,不连 DB
        rt.emit_output("result", out); rt.emit_done(out)
    except Exception as e:
        rt.emit_error(e)

if __name__ == "__main__":
    main()
