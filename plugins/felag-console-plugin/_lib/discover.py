"""插件探测:拉 github 仓 main 分支 tarball → 枚举 plugins/<name>/ 下的插件。
规则对齐 felag-server 摄取(internal/pluginsrc/extract.go):main 分支 / name==目录名 /
version 非空,保证"探测出来的"==​"能摄取的"。纯提示,不落库、不鉴权。"""
import gzip  # noqa: F401  (tarfile r:gz 依赖 gzip 已注册,显式引入更直观)
import io
import json
import tarfile
import urllib.request

TARBALL_BASE = "https://codeload.github.com"
MAX_ARCHIVE = 128 * 1024 * 1024  # 128MiB,与 felag-server maxArchiveBytes 对齐


def github_tarball_url(git_url: str) -> str:
    """从 https://github.com/<o>/<r>(可带 .git/尾斜杠)推导 codeload main tar.gz。非 github 抛 ValueError。"""
    s = git_url.strip().rstrip("/")
    if s.endswith(".git"):
        s = s[:-4]
    i = s.find("github.com/")
    if i < 0:
        raise ValueError("仅支持 github.com 源")
    parts = s[i + len("github.com/"):].split("/")
    if len(parts) < 2 or not parts[0] or not parts[1]:
        raise ValueError("无法解析 owner/repo")
    return f"{TARBALL_BASE}/{parts[0]}/{parts[1]}/tar.gz/refs/heads/main"


def enumerate_plugins(archive_gz: bytes) -> list:
    """从 repo tarball 枚举所有 */plugins/<name>/.claude-plugin/plugin.json,
    校验 name==目录名 且 version 非空,返回 [{name, version}](按 name 升序)。"""
    out = []
    with tarfile.open(fileobj=io.BytesIO(archive_gz), mode="r:gz") as tf:
        for m in tf.getmembers():
            if not m.isreg():
                continue
            idx = m.name.find("/plugins/")
            if idx < 0:
                continue
            rest = m.name[idx + len("/plugins/"):]  # 期望 <name>/.claude-plugin/plugin.json
            parts = rest.split("/")
            if len(parts) != 3 or parts[1] != ".claude-plugin" or parts[2] != "plugin.json":
                continue
            name = parts[0]
            f = tf.extractfile(m)
            if f is None:
                continue
            try:
                pj = json.loads(f.read().decode("utf-8"))
            except Exception:
                continue
            if pj.get("name") != name or not pj.get("version"):
                continue
            out.append({"name": name, "version": pj["version"]})
    out.sort(key=lambda x: x["name"])
    return out


def fetch_archive(git_url: str, timeout: int = 30) -> bytes:
    """HTTP GET codeload tarball 字节(限额 + 超时)。"""
    url = github_tarball_url(git_url)
    req = urllib.request.Request(url, headers={"User-Agent": "felag-console-plugin"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        if getattr(resp, "status", 200) != 200:
            raise ValueError(f"拉取失败 HTTP {resp.status}")
        return resp.read(MAX_ARCHIVE)


def discover(git_url: str) -> list:
    """拉取 + 枚举,返回 [{name, version}]。"""
    return enumerate_plugins(fetch_archive(git_url))
