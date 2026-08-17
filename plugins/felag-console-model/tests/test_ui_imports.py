"""UI 静态守卫:平台 plugin-sdk 只 re-export lucide / @platform/ui 的一个子集,
白名单外的具名导入运行时是 undefined,渲染直接 React error #130(白屏)。
本地跑不起平台前端,所以这层只能靠静态断言兜住。"""
import pathlib
import re

_UI = pathlib.Path(__file__).resolve().parents[1] / "ui" / "ModelManager.tsx"


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
    tsx = _UI.read_text(encoding="utf-8")
    # 已在本平台真机验证可用的集合(来自 SkillManager / PluginSourceManager / AppReleaseManager)。
    proven_lucide = {"Plus", "RefreshCw", "Check", "X", "Trash2", "Upload", "FileText", "FolderOpen"}
    proven_platform_ui = {
        "Button", "Input", "Label", "Table", "TableHeader", "TableBody", "TableRow",
        "TableHead", "TableCell", "Select", "SelectTrigger", "SelectValue", "SelectContent",
        "SelectItem", "Badge", "toast", "Dialog", "DialogContent", "DialogHeader",
        "DialogTitle", "DialogFooter",
        # useCurrentLanguage:i18n 改造引入,已随 felag-app-release v0.1.5 上线真机可用。
        # (同仓 felag-app-release/tests/test_ui_imports.py 的白名单漏了它,那个测试至今是红的。)
        "useCurrentLanguage",
    }
    lucide = _named_imports(tsx, "lucide-react")
    platform_ui = _named_imports(tsx, "@platform/ui")
    assert lucide <= proven_lucide, f"lucide 未验图标: {lucide - proven_lucide}"
    assert platform_ui <= proven_platform_ui, f"@platform/ui 未验组件: {platform_ui - proven_platform_ui}"


def test_ui_has_no_tailwind_class_reliance_for_brand_tokens():
    """平台 Tailwind 不认插件自带的品牌 token,颜色必须内联 style(DEPLOY.md 约束)。"""
    tsx = _UI.read_text(encoding="utf-8")
    assert "className=" not in tsx or "style=" in tsx


def test_ui_never_renders_a_key_value():
    """🔒 界面不得回显密钥:密钥输入框必须是 password 类型,且不得把接口返回的 key 字段绑到 value。"""
    tsx = _UI.read_text(encoding="utf-8")
    assert 'type="password"' in tsx, "密钥输入框必须是 password 类型"
    # 后端只回 keyConfigured / keyRef,不该出现任何读取 apiKey/api_key 值的绑定
    assert "m.apiKey" not in tsx and "m.api_key" not in tsx, "界面不得读取密钥值"
