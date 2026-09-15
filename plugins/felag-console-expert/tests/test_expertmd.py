"""EXPERT.md 解析/校验的单测。

这份解析器与 client 侧 Go 的 parseExpertMD 同构,两边分叉是静默错误(不报错、只是
治理后台显示的字段和数字员工实际拿到的人格对不上),所以契约要用例钉住。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from _lib import expertmd  # noqa: E402

FULL = """---
name: acoustic-inspector
displayName: 声学检测专家
profession: 工业声学检测 · NVH 异音诊断
description: 产线声学检测与 NVH 异音诊断
version: 0.1.0
avatar: 声
tags:
  - 声学检测
  - NVH 异音
skills:
  - NVH异音调研
connectors: [smartplc-diag, tinia]
defaultInitPrompt: 告诉我产线编号。
---

你是声学检测专家。

先确认测量本身可信。
"""


def test_parse_scalars_and_body():
    meta, body = expertmd.parse(FULL)
    assert meta["name"] == "acoustic-inspector"
    assert meta["displayName"] == "声学检测专家"
    assert meta["version"] == "0.1.0"
    assert meta["avatar"] == "声"
    # 值里含中文句号/冒号以外的标点不该被截断
    assert meta["defaultInitPrompt"] == "告诉我产线编号。"
    assert body.startswith("你是声学检测专家。")
    assert "先确认测量本身可信。" in body
    # frontmatter 的分隔线不能漏进正文
    assert "---" not in body


def test_parse_multiline_list():
    meta, _ = expertmd.parse(FULL)
    assert meta["tags"] == ["声学检测", "NVH 异音"]
    assert meta["skills"] == ["NVH异音调研"]


def test_parse_inline_list():
    meta, _ = expertmd.parse(FULL)
    assert meta["connectors"] == ["smartplc-diag", "tinia"]


def test_parse_no_frontmatter_is_all_body():
    meta, body = expertmd.parse("就是一段正文,没有 frontmatter")
    assert meta == {}
    assert body == "就是一段正文,没有 frontmatter"


def test_validate_passes_on_full():
    meta, body = expertmd.parse(FULL)
    assert expertmd.validate(meta, body) == []


def test_validate_flags_missing_required():
    meta, body = expertmd.parse("---\nname: x\n---\n正文")
    problems = expertmd.validate(meta, body)
    assert any("displayName" in p for p in problems)
    assert any("version" in p for p in problems)


def test_validate_rejects_bad_name():
    meta, body = expertmd.parse(
        "---\nname: bad name!\ndisplayName: X\nprofession: p\ndescription: d\nversion: 1\n---\n正文")
    assert any("name 只能是" in p for p in expertmd.validate(meta, body))


def test_validate_rejects_empty_body():
    """正文为空 = 这个专家什么都没定义,放行等于发一个空壳人格。"""
    meta, body = expertmd.parse(
        "---\nname: x\ndisplayName: X\nprofession: p\ndescription: d\nversion: 1\n---\n")
    assert any("正文" in p for p in expertmd.validate(meta, body))


def test_sha256_is_over_utf8_bytes():
    """与 server 下发时的复核口径必须一致:UTF-8 字节,不是 str 的某种内部表示。"""
    import hashlib
    s = "中文 body"
    assert expertmd.sha256_of(s) == hashlib.sha256(s.encode("utf-8")).hexdigest()
