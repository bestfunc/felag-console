"""EXPERT.md 的组装与解析。

与 client 侧 Go 的 `experts.go:parseExpertMD` **必须同构** —— 两边对同一份文件的理解一旦
分叉,治理后台显示的字段和数字员工实际拿到的人格就对不上,而且这种错不会报错、只会静默错。
契约写在 felag-client/docs/EXPERT-SPEC.md,改任何一边都要同步另一边。

这里不引 YAML 库:字段集是封闭的、由 EXPERT-SPEC 定死,一个依赖换不来什么,
反而要在插件的 requirements 里多背一个包。
"""
from __future__ import annotations

import hashlib

# 列表型字段(其余按单行标量处理)
LIST_FIELDS = ("tags", "skills", "connectors", "quickPrompts")
# 标量字段 → 表列名;None 表示只进 body、不单独入库
SCALAR_FIELDS = {
    "name": "name",
    "displayName": "display_name",
    "profession": "profession",
    "description": "description",
    "version": "version",
    "avatar": "avatar",
    "defaultInitPrompt": None,
    "category": None,
    "maxTurns": None,
}


def sha256_of(body: str) -> str:
    """按 UTF-8 字节算 sha256 —— 与 server 下发时的复核口径必须一致。"""
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def _split_inline(v: str) -> list:
    v = v.strip()
    if v.startswith("[") and v.endswith("]"):
        v = v[1:-1]
    return [p.strip() for p in v.split(",") if p.strip()]


def parse(raw: str) -> tuple:
    """解析 EXPERT.md,返回 (meta dict, body 正文)。

    没有 frontmatter 时整篇当正文、meta 为空 —— 交由调用方按「缺必填字段」报错,
    而不是在这里抛异常:调用方才知道是谁提交的、该把错误显示在哪。
    """
    lines = raw.replace("\r\n", "\n").split("\n")
    start = end = -1
    for i, l in enumerate(lines):
        if l.strip() == "---":
            if start < 0:
                start = i
            else:
                end = i
                break
    if start < 0 or end < 0:
        return {}, raw.strip()

    meta: dict = {}
    cur_list = None
    for l in lines[start + 1:end]:
        t = l.strip()
        if not t or t.startswith("#"):
            continue
        if t.startswith("- ") and cur_list is not None:
            meta[cur_list].append(t[2:].strip())
            continue
        if ":" not in t:
            continue
        key, _, val = t.partition(":")
        key, val = key.strip(), val.strip()
        cur_list = None
        if key in LIST_FIELDS:
            if val:
                meta[key] = _split_inline(val)
            else:
                meta[key] = []
                cur_list = key
        elif key in SCALAR_FIELDS:
            meta[key] = val
    return meta, "\n".join(lines[end + 1:]).strip()


# 必填字段:缺任何一个,client 那边的卡片就会露出空白或退化成目录名
REQUIRED = ("name", "displayName", "profession", "description", "version")


def validate(meta: dict, body: str) -> list:
    """返回问题列表(空 = 通过)。只做**能静态判定**的检查,不猜语义。"""
    problems = []
    for f in REQUIRED:
        if not meta.get(f):
            problems.append(f"frontmatter 缺必填字段:{f}")
    name = meta.get("name", "")
    if name and not all(c.isalnum() or c in "-_" for c in name):
        problems.append(f"name 只能是字母/数字/连字符/下划线:{name}")
    if not body.strip():
        problems.append("正文(系统提示词)为空 —— 专家的全部价值都在这段正文里")
    return problems
