"""节点 run.py 运行时契约的静态守卫。

这些 bug 只在平台真机暴露（run.py 从不本地执行、平台运行环境不同），本地 pytest 逻辑测试测不到。
2026-07-02 真机首验逐个逼出：① _lib 路径少一层 ② rt.task 属性不存在 ③ 根 requirements 缺 psycopg2。
本测试把三类做成静态断言，防回归。
"""
import pathlib
import pytest

# 两个插件包根（felag-console 与平级的 felag-console-sync）
_CONSOLE = pathlib.Path(__file__).resolve().parents[1]
_SYNC = _CONSOLE.parent / "felag-console-sync"
_PKGS = [_CONSOLE, _SYNC]

_RUNPYS = [p for pkg in _PKGS for p in (pkg / "nodes").glob("*/runtime/run.py")]


def test_有节点被扫到():
    assert len(_RUNPYS) >= 11, f"只扫到 {len(_RUNPYS)} 个 run.py，预期 ≥11（9 管理 + 2 同步）"


@pytest.mark.parametrize("runpy", _RUNPYS, ids=lambda p: str(p.relative_to(p.parents[3])))
def test_sys_path_到插件根层数正确(runpy):
    """run.py 在 nodes/<key>/runtime/run.py，到插件根需 4 层 os.path.dirname（否则 import _lib 失败）。"""
    src = runpy.read_text(encoding="utf-8")
    # 该 run.py 相对插件根的路径段数 = 需要的 dirname 次数
    depth = len(runpy.relative_to(runpy.parents[3]).parts)  # nodes/<key>/runtime/run.py = 4
    assert "os.path.abspath(__file__)" in src, f"{runpy} 未用 abspath(__file__) 定位"
    n = src.count("os.path.dirname(")
    assert n == depth, (
        f"{runpy}: sys.path 用了 {n} 层 os.path.dirname，应为 {depth} 层才能到插件根（_lib 所在）"
    )


@pytest.mark.parametrize("runpy", _RUNPYS, ids=lambda p: str(p.relative_to(p.parents[3])))
def test_不用不存在的_rt_task(runpy):
    """bestfunc_sdk.Runtime 无 .task 属性（只有 params/identity/dept/user/company/position）。"""
    src = runpy.read_text(encoding="utf-8")
    assert "rt.task" not in src, f"{runpy} 用了 rt.task（Runtime 无此属性，会 AttributeError）→ 用 rt.identity"


@pytest.mark.parametrize("pkg", _PKGS, ids=lambda p: p.name)
def test_根_requirements_声明_psycopg2(pkg):
    """平台 builder 只从根/config 的 requirements.txt 装依赖，不读 nodes/*/runtime/requirements.txt。"""
    root_req = pkg / "requirements.txt"
    assert root_req.exists(), f"{pkg.name} 缺根 requirements.txt（平台不读 nodes/*/runtime 的）"
    assert "psycopg2" in root_req.read_text(encoding="utf-8"), (
        f"{pkg.name}/requirements.txt 未声明 psycopg2（节点连库会 ModuleNotFoundError）"
    )
