"""插件探测:列仓分支(git smart-HTTP info/refs)+ 拉指定分支 tarball → 枚举 plugins/<name>/ 下的插件。
规则对齐 felag-server 摄取(internal/pluginsrc/extract.go):分支可配(默认 main)/ name==目录名 /
version 非空,保证"探测出来的"==​"能摄取的"。纯提示,不落库、不鉴权。"""
import base64
import gzip  # noqa: F401  (tarfile r:gz 依赖 gzip 已注册,显式引入更直观)
import io
import json
import tarfile
import time
import urllib.error
import urllib.request

# 121→github.com 出网间歇性抖动(实测同一请求 run1 read-timeout / run2 秒回 / run3 connect-timeout),
# 故所有幂等读请求都走短超时 + 重试;总时长控制在节点 30s 硬截止以下。
def _read_retry(req: "urllib.request.Request", timeout: int, cap: int, attempts: int = 3) -> bytes:
    """幂等 GET/读请求重试:网络类错(connect/read timeout、URLError)重试,HTTP 错(401/404/429)
    是 definitive 直接抛(不浪费重试)。全部 attempts 都网络失败 → 抛最后一个。"""
    last: Exception | None = None
    for _ in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read(cap)
        except urllib.error.HTTPError:
            raise
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last = e
    raise last if last else RuntimeError("read failed")

TARBALL_BASE = "https://codeload.github.com"
MAX_ARCHIVE = 128 * 1024 * 1024  # 128MiB,与 felag-server maxArchiveBytes 对齐
MAX_REFS = 4 * 1024 * 1024       # info/refs 广告上限(防超大响应)


def _with_auth(headers: dict, token: str | None, scheme: str = "bearer") -> dict:
    """带上 GitHub token(有则认证):认证走每账号独立高配额,codeload 匿名 429/掐断基本消失,公开仓无 scope PAT 也够。
    ⚠️ 认证方式随端点不同:codeload/REST 认 Bearer;github.com 的 git 智能 HTTP(info/refs)只认 Basic —
    对它发 Bearer 会被 GitHub 挂起直到超时(实测 25s+,进而拖过节点 30s 截止),故此处按端点分方式。token 空则匿名。"""
    h = dict(headers)
    if token:
        if scheme == "basic":
            h["Authorization"] = "Basic " + base64.b64encode((token + ":").encode()).decode()
        else:
            h["Authorization"] = "Bearer " + token
    return h


def _owner_repo(git_url: str):
    """从 https://github.com/<o>/<r>(可带 .git/尾斜杠)解析 (owner, repo)。非 github 抛 ValueError。"""
    s = git_url.strip().rstrip("/")
    if s.endswith(".git"):
        s = s[:-4]
    i = s.find("github.com/")
    if i < 0:
        raise ValueError("仅支持 github.com 源")
    parts = s[i + len("github.com/"):].split("/")
    if len(parts) < 2 or not parts[0] or not parts[1]:
        raise ValueError("无法解析 owner/repo")
    return parts[0], parts[1]


def github_tarball_url(git_url: str, branch: str = "main") -> str:
    """推导 codeload tar.gz(指定分支,默认 main)。非 github 抛 ValueError。"""
    owner, repo = _owner_repo(git_url)
    return f"{TARBALL_BASE}/{owner}/{repo}/tar.gz/refs/heads/{branch or 'main'}"


def _iter_pktlines(data: bytes):
    """遍历 git smart-HTTP pkt-line:前 4 字节 hex 为整行长(含自身),0000 为 flush。"""
    i, n = 0, len(data)
    while i + 4 <= n:
        try:
            ln = int(data[i:i + 4], 16)
        except ValueError:
            break
        if ln == 0:
            i += 4
            continue
        if ln < 4 or i + ln > n:
            break
        yield data[i + 4:i + ln]
        i += ln


def _pkt(s: str) -> bytes:
    """git pkt-line:4 字节 hex 长度前缀(含自身) + 载荷。"""
    b = s.encode()
    return ("%04x" % (len(b) + 4)).encode() + b


def _parse_ls_refs(raw: bytes) -> dict:
    """解析 git protocol v2 ls-refs 响应:每行 '<oid> <refname>[ symref-target:<t>]'。
    收 refs/heads/* 为分支;HEAD 行的 symref-target 定默认分支。"""
    default = None
    branches = []
    for line in _iter_pktlines(raw):
        text = line.rstrip(b"\n")
        parts = text.split(b" ")
        if len(parts) < 2:
            continue
        refname = parts[1].decode("utf-8", "replace")
        if refname.startswith("refs/heads/"):
            branches.append(refname[len("refs/heads/"):])
        elif refname == "HEAD":
            for a in parts[2:]:
                if a.startswith(b"symref-target:refs/heads/"):
                    default = a[len(b"symref-target:refs/heads/"):].decode("utf-8", "replace")
    branches = sorted(set(branches))
    if not default:
        default = "main" if "main" in branches else (branches[0] if branches else "main")
    return {"branches": branches, "default": default}


def _default_branch(owner: str, repo: str, timeout: int = 5, token: str | None = None) -> str | None:
    """GitHub REST /repos 取默认分支(单次小 JSON,带 token 快,实测 ~1s;抖动重试 2 次)。
    失败返 None(上层用 ls-refs 的 main-or-first 兜底)。REST 认 Bearer。"""
    url = f"https://api.github.com/repos/{owner}/{repo}"
    req = urllib.request.Request(url, headers=_with_auth({
        "User-Agent": "felag-console-plugin",
        "Accept": "application/vnd.github+json",
    }, token))
    return json.loads(_read_retry(req, timeout=timeout, cap=1 << 20, attempts=2)).get("default_branch")


def list_branches(git_url: str, timeout: int = 6, token: str | None = None) -> dict:
    """列分支 + 默认分支。分支走 git protocol v2 ls-refs(只 `ref-prefix refs/heads/`);
    默认分支走 REST /repos。返回 {'branches':[...], 'default':...};非 github 抛 ValueError。
    ⚠️ 不用 v0 info/refs:它广告仓库**所有** ref(含全部 tag),tag 极多的大仓(如 bestfunc/
    Tinia_Plugins)会拖长顶穿节点 30s 硬截止;v2 ls-refs 只要分支,响应小。
    ⚠️ 121→github.com 出网间歇抖动(同一请求时好时坏),故短超时(6s)+重试 3 次(总 ≤18s <
    节点截止);默认分支单独走 REST(带重试),失败保留 ls-refs 的 main-or-first 兜底。
    git 智能 HTTP 只认 Basic 认证。"""
    owner, repo = _owner_repo(git_url)
    url = f"https://github.com/{owner}/{repo}.git/git-upload-pack"
    body = (_pkt("command=ls-refs\n") + _pkt("object-format=sha1\n")
            + _pkt("agent=git/felag-console-plugin\n") + b"0001"
            + _pkt("ref-prefix refs/heads/\n") + b"0000")
    req = urllib.request.Request(url, data=body, headers=_with_auth({
        "User-Agent": "git/felag-console-plugin",
        "Git-Protocol": "version=2",
        "Content-Type": "application/x-git-upload-pack-request",
        "Accept": "application/x-git-upload-pack-result",
    }, token, scheme="basic"))
    raw = _read_retry(req, timeout=timeout, cap=MAX_REFS, attempts=3)
    result = _parse_ls_refs(raw)  # branches + main-or-first 兜底默认
    try:
        d = _default_branch(owner, repo, token=token)
        if d:
            result["default"] = d  # REST 真默认覆盖兜底
    except Exception:
        pass  # REST 失败保留兜底默认,不阻断列分支
    return result


def probe_version(git_url: str, branch: str, plugin: str, timeout: int = 6, token: str | None = None) -> "str | None":
    """轻量取单个插件在 branch HEAD 的版本:GitHub Contents API 只拉
    plugins/<plugin>/.claude-plugin/plugin.json(小 JSON,远比整包 tarball 便宜),读 version。
    任何失败(非 github / 网络 / 404 / base64 / 解析)→ None(软失败,列表展示 '—')。REST 认 Bearer。"""
    try:
        owner, repo = _owner_repo(git_url)
    except ValueError:
        return None
    path = f"plugins/{plugin}/.claude-plugin/plugin.json"
    url = f"https://api.github.com/repos/{owner}/{repo}/contents/{path}?ref={branch or 'main'}"
    req = urllib.request.Request(url, headers=_with_auth({
        "User-Agent": "felag-console-plugin",
        "Accept": "application/vnd.github+json",
    }, token))
    try:
        obj = json.loads(_read_retry(req, timeout=timeout, cap=1 << 20, attempts=2))
        content = obj.get("content", "")
        if obj.get("encoding") == "base64":
            content = base64.b64decode(content).decode("utf-8")
        v = json.loads(content).get("version")
        return v or None
    except Exception:
        return None


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


def fetch_archive(git_url: str, branch: str = "main", timeout: int = 12,
                  wall_clock: int = 12, token: str | None = None) -> bytes:
    """HTTP GET codeload tarball 字节(指定分支,限额 + 双重超时)。
    timeout = 单次 socket 读的不活动超时;wall_clock = 整体墙钟上限。
    urllib 的 timeout 只管单次 socket 操作,慢速稳定下载能拖过平台节点 30s 硬截止,
    故按 1MiB 分块读并卡墙钟,确保总耗时 < 节点截止,失败干净抛(上层降级软提示)。"""
    url = github_tarball_url(git_url, branch)
    req = urllib.request.Request(url, headers=_with_auth({"User-Agent": "felag-console-plugin"}, token))
    t0 = time.monotonic()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        if getattr(resp, "status", 200) != 200:
            raise ValueError(f"拉取失败 HTTP {resp.status}")
        buf = io.BytesIO()
        while True:
            if time.monotonic() - t0 > wall_clock:
                raise TimeoutError(f"下载超过 {wall_clock}s 墙钟上限")
            chunk = resp.read(1 << 20)  # 1MiB/块
            if not chunk:
                break
            buf.write(chunk)
            if buf.tell() > MAX_ARCHIVE:
                raise ValueError("包体超过大小上限")
        return buf.getvalue()


def discover(git_url: str, branch: str = "main", timeout: int = 12, token: str | None = None,
             attempts: int = 2) -> list:
    """拉取指定分支 + 枚举,返回 [{name, version}]。socket 超时 + fetch_archive 内墙钟双兜底,
    再叠 121→github 抖动重试(2 次,总 ≤24s < 节点 30s 截止);HTTP 错(404/429)definitive 不重试。
    有 token 则认证下载(codeload 匿名 429/掐断基本消失)。"""
    last: Exception | None = None
    for _ in range(attempts):
        try:
            return enumerate_plugins(fetch_archive(git_url, branch, timeout=timeout, token=token))
        except urllib.error.HTTPError:
            raise
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last = e
    raise last if last else RuntimeError("discover failed")
