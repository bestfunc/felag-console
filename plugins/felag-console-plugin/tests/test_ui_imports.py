import pathlib, re

_UI = pathlib.Path(__file__).resolve().parents[1] / "ui" / "PluginSourceManager.tsx"

def _named_imports(tsx, module):
    """抓 `import { A, B } from "module"` 里的具名导出集(支持跨行)。"""
    m = re.search(r'import\s*\{([^}]*)\}\s*from\s*[\'"]' + re.escape(module) + r'[\'"]', tsx, re.S)
    if not m:
        return set()
    return {x.strip() for x in m.group(1).split(",") if x.strip()}

def test_ui_only_whitelisted_import_sources():
    tsx = _UI.read_text(encoding="utf-8")
    # 与 felag-console/ui/SkillManager.tsx 用同一组已核实白名单来源:@platform/ui 与 lucide-react
    imports = re.findall(r'from\s+[\'"]([^\'"]+)[\'"]', tsx)
    allowed_prefixes = ("@platform/", "lucide-react", "react")
    for imp in imports:
        assert imp.startswith(allowed_prefixes), f"非白名单导入: {imp}"

def test_ui_named_exports_within_platform_whitelist():
    """具名导出必须 ⊆ SkillManager 已在平台真机验证可用的集合。
    平台 plugin-sdk 只 re-export lucide/@platform/ui 的子集;导入白名单外的名字
    (如 lucide 的 `Ban`)运行时会是 undefined → React error #130「element type invalid」。
    import build ready 与匿名 curl 都测不到(空数据不渲染该组件),故此处静态兜底。"""
    tsx = _UI.read_text(encoding="utf-8")
    # SkillManager(felag-console,已上线 app11 v208)实际使用、平台已验可用的具名导出:
    proven_lucide = {"Plus", "RefreshCw", "Check", "X", "Trash2", "Upload", "FileText", "FolderOpen"}
    proven_platform_ui = {
        "Button", "Input", "Label", "Table", "TableHeader", "TableBody", "TableRow",
        "TableHead", "TableCell", "Select", "SelectTrigger", "SelectValue", "SelectContent",
        "SelectItem", "Badge", "toast", "Dialog", "DialogContent", "DialogHeader",
        "DialogTitle", "DialogFooter", "useCurrentLanguage",
    }
    lucide = _named_imports(tsx, "lucide-react")
    platform_ui = _named_imports(tsx, "@platform/ui")
    assert lucide <= proven_lucide, f"lucide 未验图标(平台可能不 re-export): {lucide - proven_lucide}"
    assert platform_ui <= proven_platform_ui, f"@platform/ui 未验组件: {platform_ui - proven_platform_ui}"

def test_every_used_component_is_imported():
    """🔴 用了但没导入 = 运行时 ReferenceError,整页白屏。
    上面那条只管"导入的是否合法",管不住"用了却没导入" —— 同仓 felag-console-model
    就是漏导 `Select` 白过一次屏(v0.1.3)。同一份文件同一个坑,这里一并兜住。"""
    tsx = _UI.read_text(encoding="utf-8")
    imported = _named_imports(tsx, "@platform/ui") | _named_imports(tsx, "lucide-react")
    used = set(re.findall(r"<([A-Z][A-Za-z0-9]*)[\s/>]", tsx))
    # 本文件自定义的组件(function 声明 / const 箭头函数)与 React 自身
    local = set(re.findall(r"function\s+([A-Z][A-Za-z0-9]*)", tsx))
    local |= set(re.findall(r"const\s+([A-Z][A-Za-z0-9]*)\s*[:=]", tsx))
    local |= {"React"}
    # 排除 TS 泛型实参:callNode<ListResp>(...) 长得和 JSX 标签一样
    type_names = set(re.findall(r"(?:interface|type)\s+([A-Z][A-Za-z0-9]*)", tsx))
    single_letter = {n for n in used if len(n) == 1}
    missing = used - imported - local - type_names - single_letter
    assert not missing, f"这些组件用了却没导入(会运行时报 X is not defined): {sorted(missing)}"
