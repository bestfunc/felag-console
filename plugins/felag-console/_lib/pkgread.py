"""解开已存的 skill tar.gz，列出文件（文本内联、二进制仅标记）。供 version_files 节点看文件用。"""
from __future__ import annotations
import io
import tarfile

TEXT_CAP = 256 * 1024  # 单文件文本内联上限；超限或非 utf-8 → is_text=False 不带 text


def list_files(raw: bytes) -> list:
    out = []
    mode = "r:gz" if raw[:2] == b"\x1f\x8b" else "r:"  # 兼容暂存未压缩 tar 与已打包 tar.gz
    with tarfile.open(fileobj=io.BytesIO(raw), mode=mode) as tf:
        for m in tf.getmembers():
            if not m.isreg():
                continue
            entry = {"path": m.name, "size": m.size, "is_text": False}
            if m.size <= TEXT_CAP:
                data = tf.extractfile(m).read()
                try:
                    entry["text"] = data.decode("utf-8")
                    entry["is_text"] = True
                except UnicodeDecodeError:
                    pass
            out.append(entry)
    out.sort(key=lambda e: e["path"])
    return out
