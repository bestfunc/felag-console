"""skill 包结构性最小校验（非深度审查）。纯标准库 tarfile。"""
from __future__ import annotations
import io
import os
import tarfile

MAX_RAW = 8 * 1024 * 1024            # 暂存未压缩 tar 上限（旧流程 tar.gz 也走这条，够用）
MAX_UNCOMPRESSED = 16 * 1024 * 1024  # 防 tar 炸弹：累计声明 size 上限

class PackageError(ValueError):
    pass

def validate_package(raw: bytes, name: str) -> None:
    if len(raw) > MAX_RAW:
        raise PackageError(f"包大小 {len(raw)} 超过上限 {MAX_RAW} 字节")
    # 自动识别：gzip 魔数 → r:gz（tar.gz），否则 r:（未压缩 tar，本期暂存态）
    mode = "r:gz" if raw[:2] == b"\x1f\x8b" else "r:"
    try:
        tf = tarfile.open(fileobj=io.BytesIO(raw), mode=mode)
    except (tarfile.TarError, OSError) as e:
        raise PackageError(f"无法以 tar 解开：{e}") from e
    try:
        members = tf.getmembers()
    except tarfile.TarError as e:
        raise PackageError(f"tar 成员解析失败：{e}") from e
    finally:
        tf.close()

    total = 0
    top_dirs = set()
    for m in members:
        if not (m.isreg() or m.isdir()):
            raise PackageError(f"成员 {m.name!r} 类型非法（拒 symlink/hardlink/device）")
        # 检查原始名称中的路径穿越和绝对路径（tar 内部总是用 /）
        if m.name.startswith("/") or ".." in m.name.split("/"):
            raise PackageError(f"成员路径非法（穿越/绝对）：{m.name!r}")
        norm = os.path.normpath(m.name)
        if os.path.isabs(norm):
            raise PackageError(f"成员路径非法（穿越/绝对）：{m.name!r}")
        total += m.size
        if total > MAX_UNCOMPRESSED:
            raise PackageError(f"累计解压声明 size 超过 {MAX_UNCOMPRESSED}（疑 tar 炸弹）")
        # 使用 / 而非 os.path.sep，因为 tar 内部总是用 /
        top = m.name.split("/", 1)[0]
        if top and top != ".":
            top_dirs.add(top)

    if top_dirs != {name}:
        raise PackageError(f"包顶层目录必须唯一且 == skill 名 {name!r}，实际 {sorted(top_dirs)}")
