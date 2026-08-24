import pathlib, re

_UI = pathlib.Path(__file__).resolve().parents[1] / "ui" / "TokenStats.tsx"


def _named_imports(tsx, module):
    m = re.search(r'import\s*\{([^}]*)\}\s*from\s*[\'"]' + re.escape(module) + r'[\'"]', tsx, re.S)
    if not m:
        return set()
    return {x.strip() for x in m.group(1).split(",") if x.strip()}


def test_ui_only_whitelisted_import_sources():
    tsx = _UI.read_text(encoding="utf-8")
    for imp in re.findall(r'from\s+[\'"]([^\'"]+)[\'"]', tsx):
        assert imp.startswith(("@platform/", "lucide-react", "react")), f"非白名单导入: {imp}"


def test_ui_named_exports_within_platform_whitelist():
    """具名导出必须 ⊆ 同仓插件已在平台真机验证可用的集合。
    平台 plugin-sdk 只 re-export lucide/@platform/ui 子集;白名单外的名字运行时 undefined
    → React error #130,整页白屏(Rocket/Boxes/Link2 都栽过)。"""
    tsx = _UI.read_text(encoding="utf-8")
    proven_lucide = {"Plus", "RefreshCw", "Check", "X", "Trash2", "Upload", "FileText", "FolderOpen"}
    proven_platform_ui = {
        "Button", "Input", "Label", "Table", "TableHeader", "TableBody", "TableRow",
        "TableHead", "TableCell", "Select", "SelectTrigger", "SelectValue", "SelectContent",
        "SelectItem", "Badge", "toast", "Dialog", "DialogContent", "DialogHeader",
        "DialogTitle", "DialogFooter", "useCurrentLanguage",
    }
    lucide = _named_imports(tsx, "lucide-react")
    platform_ui = _named_imports(tsx, "@platform/ui")
    assert lucide <= proven_lucide, f"lucide 未验图标: {lucide - proven_lucide}"
    assert platform_ui <= proven_platform_ui, f"@platform/ui 未验组件: {platform_ui - proven_platform_ui}"


def test_ui_has_both_languages():
    """插件 i18n 契约:tsx 插件自带 zh/en 映射 + useCurrentLanguage()。"""
    tsx = _UI.read_text(encoding="utf-8")
    assert "useCurrentLanguage" in tsx
    assert re.search(r"\bzh:\s*\{", tsx) and re.search(r"\ben:\s*\{", tsx)


def test_ui_does_not_use_utc_day_for_local_range():
    """toISOString() 取的是 UTC 日期:北京时间凌晨 0-8 点会算成前一天,"今天"少一截。"""
    tsx = _UI.read_text(encoding="utf-8")
    # 只查实际调用形态(x.toISOString()),注释里点名这个 API 是刻意的说明,不该被判违规。
    assert not re.search(r"\w\.toISOString\(", tsx)
