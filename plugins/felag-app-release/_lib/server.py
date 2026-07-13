"""felag-server 对接:上传/删除安装包(共享服务令牌鉴权)。纯 stdlib urllib(与 discover.py 同风格)。

上传路径:插件 worker → felag-server 均在 121 内网 dr-net,令牌走平台库 config 通道下发。
felag-server 落盘算 sha256、返回 {filename, sha256, size};发布(切 is_current)是插件侧另一步。"""
from __future__ import annotations
import json
import urllib.error
import urllib.request

_TIMEOUT = 120  # 安装包最大 300MB,给足上传时间(内网)

class ServerError(Exception):
    pass

def _multipart_body(fields: dict, file_field: str, filename: str, data: bytes):
    """组 multipart/form-data 体。fields 为文本字段;file_field 为文件字段名。返回 (body, content_type)。"""
    boundary = "----felagAppRelease7f3b9c1d2e4a"
    parts = []
    for k, v in fields.items():
        parts.append((
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'
        ).encode("utf-8"))
    header = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\n'
        f"Content-Type: application/octet-stream\r\n\r\n"
    ).encode("utf-8")
    tail = f"\r\n--{boundary}--\r\n".encode("utf-8")
    body = b"".join(parts) + header + data + tail
    return body, f"multipart/form-data; boundary={boundary}"

def upload(base_url: str, token: str, version: str, platform: str, notes: str, data: bytes) -> dict:
    """multipart POST /app/update/upload。返回 {filename, sha256, size}。"""
    if not base_url:
        raise ServerError("felag_server_base 未配置(平台库 config 表)")
    if not token:
        raise ServerError("felag_app_upload_token 未配置(平台库 config 表)")
    url = base_url.rstrip("/") + "/app/update/upload"
    body, ct = _multipart_body(
        {"version": version, "platform": platform, "notes": notes},
        "file", f"installer-{platform}", data)
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", ct)
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = _err_body(e)
        raise ServerError(f"felag-server 上传失败 HTTP {e.code}: {detail}") from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise ServerError(f"连接 felag-server 失败: {e}") from e

def delete(base_url: str, token: str, filename: str) -> None:
    """POST /app/update/delete {filename}。文件不存在时 server 幂等返成功。"""
    if not base_url:
        raise ServerError("felag_server_base 未配置(平台库 config 表)")
    if not token:
        raise ServerError("felag_app_upload_token 未配置(平台库 config 表)")
    url = base_url.rstrip("/") + "/app/update/delete"
    body = json.dumps({"filename": filename}).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            resp.read()
    except urllib.error.HTTPError as e:
        raise ServerError(f"felag-server 删除失败 HTTP {e.code}: {_err_body(e)}") from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise ServerError(f"连接 felag-server 失败: {e}") from e

def _err_body(e: "urllib.error.HTTPError") -> str:
    try:
        return e.read().decode("utf-8", "replace")[:200]
    except Exception:
        return ""
