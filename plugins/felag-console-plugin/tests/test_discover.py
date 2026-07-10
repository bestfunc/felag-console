import io, json, tarfile
import pytest
from _lib import discover, nodes_impl as N

def _tarball(files: dict) -> bytes:
    """造 github 风格 tar.gz(顶层 repo-main/,内嵌给定路径/内容)。"""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for path, content in files.items():
            data = content.encode("utf-8")
            ti = tarfile.TarInfo(path); ti.size = len(data)
            tf.addfile(ti, io.BytesIO(data))
    return buf.getvalue()

def test_enumerate_ok_and_sorted():
    tb = _tarball({
        "repo-main/plugins/foo/.claude-plugin/plugin.json": json.dumps({"name": "foo", "version": "1.2.3"}),
        "repo-main/plugins/foo/skills/x.md": "hi",
        "repo-main/plugins/bar/.claude-plugin/plugin.json": json.dumps({"name": "bar", "version": "0.1.0"}),
        "repo-main/plugins/_shared/util.py": "x",   # 无 plugin.json → 跳过
        "repo-main/README.md": "x",
    })
    assert discover.enumerate_plugins(tb) == [
        {"name": "bar", "version": "0.1.0"},
        {"name": "foo", "version": "1.2.3"},
    ]

def test_enumerate_skips_name_mismatch_and_empty_version():
    tb = _tarball({
        "r-main/plugins/foo/.claude-plugin/plugin.json": json.dumps({"name": "WRONG", "version": "1"}),
        "r-main/plugins/baz/.claude-plugin/plugin.json": json.dumps({"name": "baz", "version": ""}),
        "r-main/plugins/qux/.claude-plugin/plugin.json": "not-json{",
    })
    assert discover.enumerate_plugins(tb) == []

def test_github_url_derivation():
    assert discover.github_tarball_url("https://github.com/bestfunc/bi_plugins.git") == \
        "https://codeload.github.com/bestfunc/bi_plugins/tar.gz/refs/heads/main"
    assert discover.github_tarball_url("https://github.com/o/r/") == \
        "https://codeload.github.com/o/r/tar.gz/refs/heads/main"

def test_github_url_with_branch():
    assert discover.github_tarball_url("https://github.com/bestfunc/Tinia_Plugins", "latest") == \
        "https://codeload.github.com/bestfunc/Tinia_Plugins/tar.gz/refs/heads/latest"
    assert discover.github_tarball_url("https://github.com/o/r", "") == \
        "https://codeload.github.com/o/r/tar.gz/refs/heads/main"   # 空分支→main

def test_github_url_rejects_non_github():
    with pytest.raises(ValueError):
        discover.github_tarball_url("https://gitlab.com/o/r")
    with pytest.raises(ValueError):
        discover.github_tarball_url("https://github.com/onlyowner")

def _pkt(line: bytes) -> bytes:
    return f"{len(line) + 4:04x}".encode() + line

def test_parse_ls_refs_branches_and_symref_default():
    """v2 ls-refs 响应:HEAD 带 symref-target 定默认;只收 refs/heads/*。"""
    sha = b"a" * 40
    raw = (
        _pkt(sha + b" HEAD symref-target:refs/heads/latest\n") +
        _pkt(sha + b" refs/heads/latest\n") +
        _pkt(sha + b" refs/heads/feature/v1.1\n") +
        b"0000"
    )
    got = discover._parse_ls_refs(raw)
    assert got["branches"] == ["feature/v1.1", "latest"]
    assert got["default"] == "latest"

def test_parse_ls_refs_default_falls_back_to_main():
    sha = b"b" * 40
    raw = (
        _pkt(sha + b" refs/heads/main\n") +
        _pkt(sha + b" refs/heads/dev\n") +
        b"0000"
    )
    got = discover._parse_ls_refs(raw)
    assert got["branches"] == ["dev", "main"]
    assert got["default"] == "main"   # 无 HEAD symref → main 优先

def test_handle_discover_requires_git_url():
    with pytest.raises(N.NodeError):
        N.handle_plugin_discover({})

def test_handle_discover_non_github_is_nodeerror():
    with pytest.raises(N.NodeError):
        N.handle_plugin_discover({"git_url": "https://gitlab.com/o/r"})

def test_handle_discover_enumerate_failure_degrades_soft(monkeypatch):
    """传了 branch → 只枚举该分支;枚举失败(网络/超时)不打死节点:plugins 空 + plugins_error 软提示。"""
    def _boom(url, branch, timeout=12, token=None):
        raise TimeoutError("timed out")
    monkeypatch.setattr(discover, "discover", _boom)
    out = N.handle_plugin_discover({"git_url": "https://github.com/o/r", "branch": "main"})
    assert out["plugins"] == []
    assert "plugins_error" in out and "手填" in out["plugins_error"]

def test_handle_discover_no_branch_lists_branches(monkeypatch):
    """没传 branch → 只列分支(不枚举),返回 branches + default_branch。"""
    monkeypatch.setattr(discover, "list_branches",
                        lambda url, timeout=6, token=None: {"branches": ["latest", "dev"], "default": "latest"})
    out = N.handle_plugin_discover({"git_url": "https://github.com/o/r"})
    assert out["branches"] == ["latest", "dev"]
    assert out["default_branch"] == "latest"
    assert "plugins" not in out
