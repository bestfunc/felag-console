import pathlib, re

_UI = pathlib.Path(__file__).resolve().parents[1] / "ui" / "AppReleaseManager.tsx"

def _named_imports(tsx, module):
    m = re.search(r'import\s*\{([^}]*)\}\s*from\s*[\'"]' + re.escape(module) + r'[\'"]', tsx, re.S)
    if not m:
        return set()
    return {x.strip() for x in m.group(1).split(",") if x.strip()}

def test_ui_only_whitelisted_import_sources():
    tsx = _UI.read_text(encoding="utf-8")
    imports = re.findall(r'from\s+[\'"]([^\'"]+)[\'"]', tsx)
    allowed_prefixes = ("@platform/", "lucide-react", "react")
    for imp in imports:
        assert imp.startswith(allowed_prefixes), f"非白名单导入: {imp}"

def test_ui_named_exports_within_platform_whitelist():
    """具名导出必须 ⊆ SkillManager/PluginSourceManager 已在平台真机验证可用的集合。
    平台 plugin-sdk 只 re-export lucide/@platform/ui 子集;白名单外的名字运行时 undefined → React error #130。"""
    tsx = _UI.read_text(encoding="utf-8")
    proven_lucide = {"Plus", "RefreshCw", "Check", "X", "Trash2", "Upload", "FileText", "FolderOpen"}
    proven_platform_ui = {
        "Button", "Input", "Label", "Table", "TableHeader", "TableBody", "TableRow",
        "TableHead", "TableCell", "Select", "SelectTrigger", "SelectValue", "SelectContent",
        "SelectItem", "Badge", "toast", "Dialog", "DialogContent", "DialogHeader",
        "DialogTitle", "DialogFooter",
    }
    lucide = _named_imports(tsx, "lucide-react")
    platform_ui = _named_imports(tsx, "@platform/ui")
    assert lucide <= proven_lucide, f"lucide 未验图标: {lucide - proven_lucide}"
    assert platform_ui <= proven_platform_ui, f"@platform/ui 未验组件: {platform_ui - proven_platform_ui}"
