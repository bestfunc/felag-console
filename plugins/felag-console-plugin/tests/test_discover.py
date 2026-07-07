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

def test_github_url_rejects_non_github():
    with pytest.raises(ValueError):
        discover.github_tarball_url("https://gitlab.com/o/r")
    with pytest.raises(ValueError):
        discover.github_tarball_url("https://github.com/onlyowner")

def test_handle_discover_requires_git_url():
    with pytest.raises(N.NodeError):
        N.handle_plugin_discover({})

def test_handle_discover_non_github_is_nodeerror():
    with pytest.raises(N.NodeError):
        N.handle_plugin_discover({"git_url": "https://gitlab.com/o/r"})
