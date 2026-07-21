import { useState, useCallback, useEffect } from "react";
import { Button, Input, Label, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Badge, toast,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, useCurrentLanguage } from "@platform/ui";
import { Plus, RefreshCw, Check, X, Trash2 } from "lucide-react";

const SLUG = "felag-console-plugin";

// ── i18n(PD_001_30):单文件 tsx 插件自带轻量语言包;useCurrentLanguage() 随平台切换响应式返回 'zh'|'en'。
//    子组件(StatusBadge/ScopeCascader)各自调 useCurrentLanguage();模块级 callNode 拿不到 hook,传 t。 ──
const I18N = {
  zh: {
    reqFail: "请求失败",
    approved: "已通过", deprecated: "已停用", pendingReview: "待审核",
    title: "插件源管理", refresh: "刷新", newSource: "新建源",
    thPlugin: "插件", thVersion: "版本", thScope: "作用域", thStatus: "状态", thActions: "操作",
    view: "查看", setName: "设置名称", approve: "审核通过", delete: "删除", update: "更新", deprecateBtn: "停用",
    noSources: "暂无插件源",
    noPluginsInBranch: (b: string) => `分支 ${b} 下未发现可用插件`,
    needGitFirst: "请先填 Git 地址",
    needGitUrl: "请填 git_url", needPlugin: "请填 plugin", needScope: "请选择作用域",
    submitted: "已提交待审核", deleted: "已删除",
    renamedApproved: "已更新展示名，约 30 秒内下发到客户端", renamed: "已更新展示名",
    syncRequested: "已请求同步，约 30 秒内 felag-server 会重新摄取该源",
    inputEyebrow: "INPUT · 输入", newSourceDialog: "新建插件源",
    gitUrl: "Git 地址", discovering: "探测中…", discover: "探测",
    branch: "分支", selectBranch: "选择分支",
    pluginPkg: "插件包名",
    pluginPkgPlaceholder: "插件仓库里的技术包名（可手填，或点上方探测结果）",
    pluginPkgHint: "须与仓库 plugin.json 的 name 一致，摄取时会校验，不是给人看的名字",
    displayName: "展示名",
    displayNamePlaceholder: "给人看的友好名（选填，如“智能质量”）；空则用包名",
    displayNameHint: "数字员工客户端的连接器卡片会显示这个名字",
    submitting: "提交中…", submitReview: "提交待审核",
    detailEyebrow: "DETAIL · 源详情", close: "关闭",
    renameEyebrow: "RENAME · 设置名称", setDisplayName: "设置展示名",
    renamePkgLabel: "插件包名 ", renamePkgNote: " · 仅改展示名，其它不变",
    renamePlaceholder: "给人看的友好名（留空则用包名）",
    cancel: "取消", saving: "保存中…", save: "保存",
    colEmpty: "（空）", selAllDepts: "选中=全部部门", selAllPos: "选中=全部岗位",
    unitDept: "部门", unitPos: "岗位", dotAllDepts: " · 全部部门", dotAllPos: " · 全部岗位",
    selectedPrefix: (label: string) => `已选：${label}`,
    cascaderHint: "点部门=选其“全部岗位”，含下级会自动展开右侧供细选",
    tabGit: "第三方源", tabOfficial: "官方插件", officialEyebrow: "OFFICIAL · 系统自带",
    noOfficial: "暂无官方插件", credsOk: "凭据已配", credsMissing: "凭据未配", setCreds: "配置凭据",
    enabledScopesLabel: "已启用作用域", enableHere: "启用到作用域", enableBtn: "启用", disableBtn: "停用",
    enabledOk: "已启用（约 30 秒内下发到客户端）", disabledOk: "已停用",
    credDialogTitle: "配置飞书应用凭据", credHint: "凭据仅超管可配，随插件签名下发到客户端，用于用户登录飞书。",
    credAppId: "App ID", credAppSecret: "App Secret", credsSaved: "凭据已保存",
    needCredsFirst: "请先配置应用凭据再启用", noEnabledScopes: "尚未在任何作用域启用",
    pickScopeEnable: "选择作用域后启用",
    enabledMark: "已启用", credConfiguredHint: "已配置，留空表示不修改",
  },
  en: {
    reqFail: "Request failed",
    approved: "Approved", deprecated: "Disabled", pendingReview: "Pending",
    title: "Plugin Sources", refresh: "Refresh", newSource: "New source",
    thPlugin: "Plugin", thVersion: "Version", thScope: "Scope", thStatus: "Status", thActions: "Actions",
    view: "View", setName: "Set name", approve: "Approve", delete: "Delete", update: "Update", deprecateBtn: "Disable",
    noSources: "No plugin sources yet",
    noPluginsInBranch: (b: string) => `No usable plugins found on branch ${b}`,
    needGitFirst: "Please enter a Git URL first",
    needGitUrl: "Please enter git_url", needPlugin: "Please enter plugin", needScope: "Please choose a scope",
    submitted: "Submitted for review", deleted: "Deleted",
    renamedApproved: "Display name updated, reaches clients within ~30s", renamed: "Display name updated",
    syncRequested: "Sync requested; felag-server will re-ingest this source within ~30s",
    inputEyebrow: "INPUT", newSourceDialog: "New plugin source",
    gitUrl: "Git URL", discovering: "Probing…", discover: "Probe",
    branch: "Branch", selectBranch: "Choose branch",
    pluginPkg: "Plugin package name",
    pluginPkgPlaceholder: "Technical package name in the repo (type manually, or click a probe result above)",
    pluginPkgHint: "Must match the name in the repo's plugin.json; verified on ingest, not a human-facing name",
    displayName: "Display name",
    displayNamePlaceholder: "Friendly name (optional, e.g. “Smart Quality”); empty uses the package name",
    displayNameHint: "This name shows on the connector card in the digital-employee client",
    submitting: "Submitting…", submitReview: "Submit for review",
    detailEyebrow: "DETAIL", close: "Close",
    renameEyebrow: "RENAME", setDisplayName: "Set display name",
    renamePkgLabel: "Plugin package ", renamePkgNote: " · only the display name changes, nothing else",
    renamePlaceholder: "Friendly name (empty uses the package name)",
    cancel: "Cancel", saving: "Saving…", save: "Save",
    colEmpty: "(empty)", selAllDepts: "select = all departments", selAllPos: "select = all positions",
    unitDept: "dept.", unitPos: "pos.", dotAllDepts: " · all departments", dotAllPos: " · all positions",
    selectedPrefix: (label: string) => `Selected: ${label}`,
    cascaderHint: "Click a department to select all its positions; nodes with children expand on the right for finer selection",
    tabGit: "Third-party", tabOfficial: "Official", officialEyebrow: "OFFICIAL · built-in",
    noOfficial: "No official plugins", credsOk: "credentials set", credsMissing: "credentials missing", setCreds: "Configure credentials",
    enabledScopesLabel: "Enabled scopes", enableHere: "Enable for scope", enableBtn: "Enable", disableBtn: "Disable",
    enabledOk: "Enabled (reaches clients within ~30s)", disabledOk: "Disabled",
    credDialogTitle: "Configure Feishu app credentials", credHint: "Superadmin only; distributed with the signed plugin for users to log in to Feishu.",
    credAppId: "App ID", credAppSecret: "App Secret", credsSaved: "Credentials saved",
    needCredsFirst: "Configure credentials before enabling", noEnabledScopes: "Not enabled in any scope",
    pickScopeEnable: "Pick a scope then enable",
    enabledMark: "Enabled", credConfiguredHint: "Configured; leave blank to keep unchanged",
  },
};
type Dict = typeof I18N.zh;

// ── Ice Blue Enterprise 品牌值（bestfunc-design skill §1/§2/§5）──
// 平台 Tailwind 预编译、不认插件新加的具名 token → 品牌值走内联 style（运行时插件里稳定渲染）。
const C = {
  signal: "#0A84FF", signalHover: "#0A78E6", ink: "#071225", body: "#334155",
  muted: "#64748B", line: "#D8E2F0", surface: "#FFFFFF", surface2: "#F1F6FD",
  blueTint: "#EAF4FF", ok: "#1D9E75", ng: "#F43F5E",
  signalTint: "rgba(10,132,255,.08)", okTint: "rgba(29,158,117,.08)", ngTint: "rgba(244,63,94,.08)",
  warnText: "#B45309", warnBg: "#FEF3C7", warnBorder: "#F59E0B",
};
const FZH = '"Noto Sans SC","PingFang SC",sans-serif';
const FMONO = '"JetBrains Mono",ui-monospace,monospace';
const SHADOW_CARD = "0 18px 45px rgba(7,18,37,.06)";
const SHADOW_FEATURED = "0 22px 56px rgba(10,132,255,.10)";
const AURORA =
  "radial-gradient(circle at 12% 0%, rgba(10,132,255,.08), transparent 28%)," +
  "radial-gradient(circle at 90% 10%, rgba(0,169,157,.07), transparent 30%)," +
  "linear-gradient(180deg,#F8FBFF 0%,#EEF4FB 100%)";

const eyebrow = (mb = 0): React.CSSProperties => ({
  fontFamily: FMONO, fontSize: 12, letterSpacing: ".16em", textTransform: "uppercase",
  color: C.signal, marginBottom: mb,
});
const labelStyle: React.CSSProperties = { ...eyebrow(8), display: "block" };
const pill = (color: string, bg: string): React.CSSProperties => ({
  color, background: bg, border: `1px solid ${color}55`, fontFamily: FMONO, fontSize: 12,
  letterSpacing: ".08em", borderRadius: 999,
});
const btnPrimary: React.CSSProperties = {
  background: C.signal, color: "#fff", borderRadius: 999, fontFamily: FZH, fontWeight: 800,
  boxShadow: SHADOW_CARD, border: "none",
};
const btnGhost: React.CSSProperties = {
  background: C.surface, border: `1px solid ${C.line}`, color: C.ink, borderRadius: 999,
  fontFamily: FZH, fontWeight: 700,
};
const btnDanger: React.CSSProperties = {
  background: C.ng, color: "#fff", borderRadius: 999, fontFamily: FZH, fontWeight: 700, border: "none",
};
const cardStyle: React.CSSProperties = {
  background: "rgba(255,255,255,.92)", border: `1px solid ${C.line}`, borderRadius: 22,
  boxShadow: SHADOW_CARD, overflow: "hidden",
};
const thStyle: React.CSSProperties = {
  fontFamily: FMONO, fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase", color: C.muted,
};
const inputStyle: React.CSSProperties = { border: `1px solid ${C.line}`, borderRadius: 14, color: C.ink };
const dialogStyle: React.CSSProperties = {
  background: C.surface, border: `1px solid ${C.line}`, borderRadius: 24, boxShadow: SHADOW_FEATURED,
  fontFamily: FZH, width: "94vw", maxWidth: 640, maxHeight: "88vh", overflowY: "auto",
};

async function callNode<T>(node: string, params: object, t: Dict): Promise<T> {
  const resp = await fetch(`/api/dag/${SLUG}/${node}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
  });
  const env = await resp.json();
  const first = env?.data?.results?.[0];
  if (env?.code !== 0 || first?.error) {
    const raw = first?.error || env?.message || t.reqFail;
    const m = String(raw).match(/(?:ValueError|RuntimeError|NodeError|TypeError):\s*([^\n]+)/);
    throw new Error(m ? m[1].trim() : String(raw));
  }
  return first?.output?.result as T;
}

type Scope = { scope_ref: string; label: string; parent_ref?: string | null };
type OfficialPlugin = {
  key: string; plugin: string; display_name: string; display_name_en: string; description: string;
  cred_keys: string[]; creds_configured: boolean; enabled_scopes: string[];
  cred_values?: Record<string, string>; // 非机密凭据回显(app_id 一类)供编辑预填;机密键(secret)后端不回
};
type Source = {
  id: number; git_url: string; plugin: string; display_name?: string | null; scope_ref: string; branch: string; status: string;
  created_by: string; reviewed_by: string | null; created_at?: string; reviewed_at?: string | null;
  git_version?: string | null; sync_requested_at?: string | null;
};

function StatusBadge({ status }: { status: string }) {
  const t = I18N[useCurrentLanguage()];
  if (status === "approved") return <Badge style={pill(C.ok, C.okTint)}>{t.approved}</Badge>;
  if (status === "deprecated") return <Badge style={pill(C.ng, C.ngTint)}>{t.deprecated}</Badge>;
  return <Badge style={{ color: C.warnText, background: C.warnBg, border: `1px solid ${C.warnBorder}66`, fontFamily: FMONO, fontSize: 12, borderRadius: 999 }}>{t.pendingReview}</Badge>;
}

// 作用域列式级联(changeOnSelect):点任一节点=直接选中它(总部=全部部门 / 部门=该部门全部岗位 / 岗位=该岗位),
// 含子级的节点点选后右侧自动展开供细选,无需再点三角。右侧件数徽章提示"还能往下选"(用 mono 文本非符号图标,合白名单)。
function ScopeCascader({ scopes, value, onChange, enabledSet }: { scopes: Scope[]; value: string; onChange: (ref: string) => void; enabledSet?: Set<string> }) {
  const t = I18N[useCurrentLanguage()];
  const [path, setPath] = useState<string[]>([]);
  const refset = new Set(scopes.map((s) => s.scope_ref));
  const byRef: Record<string, Scope> = {};
  scopes.forEach((s) => { byRef[s.scope_ref] = s; });
  const isRoot = (s: Scope) => !s.parent_ref || !refset.has(s.parent_ref);
  const isDept = (ref: string) => ref.startsWith("dept:") || ref.startsWith("branch:");
  const childrenOf = (ref: string) => scopes.filter((s) => s.parent_ref === ref).sort((a, b) => a.label.localeCompare(b.label));
  const roots = scopes.filter(isRoot).sort((a, b) => a.label.localeCompare(b.label));

  const columns: Scope[][] = [roots];
  for (const p of path) { const kids = childrenOf(p); if (kids.length) columns.push(kids); }

  const selLabel = (ref: string): string => {
    const n = byRef[ref]; if (!n) return ref;
    if (isDept(ref)) return n.label + (isRoot(n) ? t.dotAllDepts : t.dotAllPos);
    const par = n.parent_ref ? byRef[n.parent_ref] : undefined;
    return (par ? par.label + " / " : "") + n.label;
  };
  // 选中即下钻:选它 + 有子级则展开右侧列(截掉更深旧路径),无子级则收拢到本层
  const pick = (ci: number, n: Scope) => {
    onChange(n.scope_ref);
    const kids = childrenOf(n.scope_ref);
    setPath((prev) => (kids.length ? [...prev.slice(0, ci), n.scope_ref] : prev.slice(0, ci)));
  };

  return (
    <div>
      {/* 列区自身横向内滚,绝不把弹窗撑出横条(层数多时在此滚动) */}
      <div style={{ overflowX: "auto", border: `1px solid ${C.line}`, borderRadius: 14, background: C.surface }}>
        <div style={{ display: "flex", minWidth: "min-content" }}>
          {columns.map((col, ci) => (
            <div key={ci} style={{ flex: "0 0 162px", width: 162, maxHeight: 248, overflowY: "auto",
              borderRight: ci < columns.length - 1 ? `1px solid ${C.surface2}` : "none" }}>
              {col.length === 0 && <div style={{ padding: 10, fontFamily: FMONO, fontSize: 12, color: C.muted }}>{t.colEmpty}</div>}
              {col.map((n) => {
                const kids = childrenOf(n.scope_ref);
                const dept = isDept(n.scope_ref);
                const selected = value === n.scope_ref;
                const opened = path[ci] === n.scope_ref;
                const enabled = !!enabledSet?.has(n.scope_ref);
                return (
                  <div key={n.scope_ref} onClick={() => pick(ci, n)}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6,
                      padding: "8px 10px", cursor: "pointer", fontFamily: FZH, fontSize: 13,
                      color: selected ? C.signal : C.ink,
                      background: selected ? C.blueTint : opened ? C.surface2 : C.surface,
                      borderBottom: `1px solid ${C.surface2}` }}>
                    <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.3, minWidth: 0 }}>
                      <span style={{ fontWeight: selected ? 700 : 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.label}</span>
                      {dept && (
                        <span style={{ fontFamily: FMONO, fontSize: 12, color: C.muted, letterSpacing: ".02em" }}>
                          {isRoot(n) ? t.selAllDepts : t.selAllPos}
                        </span>
                      )}
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      {enabled && (
                        <span style={{ display: "flex", alignItems: "center", gap: 2, fontFamily: FMONO, fontSize: 11,
                          color: C.ok, background: C.okTint, border: `1px solid ${C.ok}44`, borderRadius: 999, padding: "1px 6px" }}>
                          <Check className="size-3" />{t.enabledMark}
                        </span>
                      )}
                      {kids.length > 0 && (
                        <span style={{ fontFamily: FMONO, fontSize: 12, letterSpacing: ".02em",
                          color: opened ? C.signal : C.muted, background: opened ? C.blueTint : C.surface2,
                          border: `1px solid ${opened ? C.signal + "55" : C.line}`, borderRadius: 999, padding: "1px 7px" }}>
                          {kids.length} {isRoot(n) ? t.unitDept : t.unitPos}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 6, fontFamily: FMONO, fontSize: 12, color: value ? C.signal : C.muted }}>
        {value ? t.selectedPrefix(selLabel(value)) : t.cascaderHint}
      </div>
    </div>
  );
}

export default function PluginSourceManager() {
  const lang = useCurrentLanguage();
  const t = I18N[lang];
  const [sources, setSources] = useState<Source[]>([]);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ git_url: "", plugin: "", display_name: "", scope_ref: "", branch: "" });
  // 设置名称（只改展示名）：编辑中的源 + 输入值
  const [renaming, setRenaming] = useState<Source | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  // 查看详情（git 地址/分支/包名收进弹窗，压窄表格）
  const [viewing, setViewing] = useState<Source | null>(null);
  const [busy, setBusy] = useState(false);
  // 官方插件 tab
  const [tab, setTab] = useState<"git" | "official">("git");
  const [official, setOfficial] = useState<OfficialPlugin[]>([]);
  const [enScope, setEnScope] = useState<Record<string, string>>({}); // pluginKey → 待启用 scope_ref
  const [credEditing, setCredEditing] = useState<OfficialPlugin | null>(null);
  const [credForm, setCredForm] = useState({ lark_app_id: "", lark_app_secret: "" });
  const [credBusy, setCredBusy] = useState(false);
  const [discovered, setDiscovered] = useState<{ name: string; version: string }[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const ctx = await callNode<{ manageable_scopes: Scope[] }>("actor_context", {}, t);
      setScopes(ctx.manageable_scopes);
      const r = await callNode<{ sources: Source[] }>("plugin_source_list", {}, t);
      setSources(r.sources);
      const o = await callNode<{ plugins: OfficialPlugin[] }>("official_list", {}, t);
      setOfficial(o.plugins);
    } catch (e: any) { toast.error(e.message); }
  }, [t]);

  useEffect(() => { refresh(); }, [refresh]);

  // scope_ref（dept:12 / pos:1）→ 组织名，用 actor_context 拿到的可管作用域映射；无匹配回退原码
  const scopeName = (ref: string) => scopes.find((s) => s.scope_ref === ref)?.label || ref;

  function openCreate() {
    setForm({ git_url: "", plugin: "", display_name: "", scope_ref: "", branch: "" });
    setDiscovered([]); setBranches([]); setCreateOpen(true);
  }

  // 枚举某分支下的插件(填探测结果提示;枚举=下载整包,大仓/慢网可能软失败,此时插件名手填即可)
  async function enumerate(git_url: string, branch: string) {
    const r = await callNode<{ plugins?: { name: string; version: string }[]; plugins_error?: string }>("plugin_discover", { git_url, branch }, t);
    const plugins = r.plugins ?? [];
    setDiscovered(plugins);
    if (r.plugins_error) toast.error(r.plugins_error);
    else if (plugins.length === 0) toast.error(t.noPluginsInBranch(branch));
  }

  // 探测:先列所有分支(git smart-HTTP,不吃 REST 限流)→ 选默认分支 → 枚举该分支插件;分支/插件名仍可手填
  async function doDiscover() {
    const git_url = form.git_url.trim();
    if (!git_url) { toast.error(t.needGitFirst); return; }
    setDiscovering(true);
    try {
      const r = await callNode<{ branches: string[]; default_branch: string }>("plugin_discover", { git_url }, t);
      setBranches(r.branches);
      const br = r.default_branch || "main";
      setForm((f) => ({ ...f, branch: br }));
      await enumerate(git_url, br);
    } catch (e: any) { toast.error(e.message); }
    finally { setDiscovering(false); }
  }

  // 切分支:重新枚举该分支下插件(清空已选插件避免跨分支串味)
  async function onBranchChange(br: string) {
    setForm((f) => ({ ...f, branch: br, plugin: "" }));
    const git_url = form.git_url.trim();
    if (git_url) { try { await enumerate(git_url, br); } catch (e: any) { toast.error(e.message); } }
  }

  async function doCreate() {
    const git_url = form.git_url.trim();
    const plugin = form.plugin.trim();
    const display_name = form.display_name.trim();
    const branch = form.branch.trim() || "main";
    if (!git_url) { toast.error(t.needGitUrl); return; }
    if (!plugin) { toast.error(t.needPlugin); return; }
    if (!form.scope_ref) { toast.error(t.needScope); return; }
    setBusy(true);
    try {
      await callNode("plugin_source_create", { git_url, plugin, display_name, scope_ref: form.scope_ref, branch }, t);
      toast.success(t.submitted); setCreateOpen(false); refresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function review(source_id: number, action: "approve" | "deprecate") {
    try {
      await callNode("plugin_source_review", { source_id, action }, t);
      toast.success(action === "approve" ? t.approved : t.deprecated);
      refresh();
    } catch (e: any) { toast.error(e.message); }
  }

  async function remove(source_id: number) {
    try {
      await callNode("plugin_source_delete", { source_id }, t);
      toast.success(t.deleted);
      refresh();
    } catch (e: any) { toast.error(e.message); }
  }

  // 设置名称:只改展示名,其它列不动;打开弹窗预填当前展示名
  function openRename(s: Source) {
    setRenaming(s); setRenameVal(s.display_name || "");
  }
  async function doRename() {
    if (!renaming) return;
    setRenameBusy(true);
    try {
      await callNode("plugin_source_rename", { source_id: renaming.id, display_name: renameVal.trim() }, t);
      toast.success(renaming.status === "approved" ? t.renamedApproved : t.renamed);
      setRenaming(null); refresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setRenameBusy(false); }
  }

  // 官方插件:在某作用域启用/停用;配置应用凭据(超管)
  async function enableOfficial(plugin_key: string) {
    const scope_ref = enScope[plugin_key];
    if (!scope_ref) { toast.error(t.needScope); return; }
    try {
      await callNode("official_enable", { plugin_key, scope_ref }, t);
      toast.success(t.enabledOk); refresh();
    } catch (e: any) { toast.error(e.message); }
  }
  async function disableOfficial(plugin_key: string, scope_ref: string) {
    try {
      await callNode("official_disable", { plugin_key, scope_ref }, t);
      toast.success(t.disabledOk); refresh();
    } catch (e: any) { toast.error(e.message); }
  }
  function openCreds(p: OfficialPlugin) {
    // 预填已配的非机密值(app_id)让管理员"知道老的";机密(secret)留空 = 不修改。
    setCredEditing(p); setCredForm({ lark_app_id: p.cred_values?.lark_app_id || "", lark_app_secret: "" });
  }
  async function saveCreds() {
    if (!credEditing) return;
    const creds: Record<string, string> = {};
    if (credForm.lark_app_id.trim()) creds.lark_app_id = credForm.lark_app_id.trim();
    if (credForm.lark_app_secret.trim()) creds.lark_app_secret = credForm.lark_app_secret.trim();
    setCredBusy(true);
    try {
      await callNode("official_set_creds", { plugin_key: credEditing.key, creds }, t);
      toast.success(t.credsSaved); setCredEditing(null); refresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setCredBusy(false); }
  }

  // 请求立即同步:置 sync_requested_at,felag-server 快轮询(约 30s)拾取后重摄该源
  async function sync(source_id: number) {
    try {
      await callNode("plugin_source_sync", { source_id }, t);
      toast.success(t.syncRequested);
      refresh();
    } catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="px-8 py-6 space-y-5" style={{ background: AURORA, minHeight: "100%", fontFamily: FZH }}>
      <div className="flex items-end justify-between">
        <div>
          <div style={eyebrow(4)}>PLUGIN SOURCE GOVERNANCE</div>
          <h1 style={{ fontFamily: FZH, fontWeight: 800, fontSize: 26, color: C.ink, letterSpacing: "-0.02em" }}>{t.title}</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" style={btnGhost} onClick={refresh}><RefreshCw className="size-4 mr-1" />{t.refresh}</Button>
          {tab === "git" && <Button style={btnPrimary} onClick={openCreate}><Plus className="size-4 mr-1" />{t.newSource}</Button>}
        </div>
      </div>

      {/* Tab 切换:第三方源 / 官方插件 */}
      <div style={{ display: "flex", gap: 6 }}>
        {(["git", "official"] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ fontFamily: FZH, fontWeight: 700, fontSize: 14, padding: "7px 16px", borderRadius: 999,
              cursor: "pointer", border: `1px solid ${tab === k ? C.signal : C.line}`,
              background: tab === k ? C.blueTint : C.surface, color: tab === k ? C.signal : C.body }}>
            {k === "git" ? t.tabGit : t.tabOfficial}
          </button>
        ))}
      </div>

      {tab === "official" && (
        <div className="space-y-4">
          {official.map((p) => {
            const dn = lang === "en" && p.display_name_en ? p.display_name_en : p.display_name;
            const sel = enScope[p.key] || "";                       // 当前在 cascader 选中的 scope
            const selEnabled = !!sel && p.enabled_scopes.includes(sel); // 选中的 scope 是否已启用 → 按钮切"停用"
            return (
              <div key={p.key} style={{ ...cardStyle, padding: 18 }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={eyebrow(4)}>{t.officialEyebrow}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontFamily: FZH, fontWeight: 800, fontSize: 18, color: C.ink }}>{dn}</span>
                      <Badge style={p.creds_configured ? pill(C.ok, C.okTint) : pill(C.warnText, C.warnBg)}>
                        {p.creds_configured ? t.credsOk : t.credsMissing}
                      </Badge>
                    </div>
                    <div style={{ fontFamily: FZH, fontSize: 13, color: C.muted, marginTop: 4 }}>{p.description}</div>
                  </div>
                  <Button variant="outline" style={btnGhost} onClick={() => openCreds(p)}>{t.setCreds}</Button>
                </div>

                {/* 已启用作用域 */}
                <div style={{ marginTop: 14 }}>
                  <div style={{ ...eyebrow(6) }}>{t.enabledScopesLabel}</div>
                  {p.enabled_scopes.length === 0
                    ? <div style={{ fontFamily: FMONO, fontSize: 12, color: C.muted }}>{t.noEnabledScopes}</div>
                    : <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {p.enabled_scopes.map((s) => (
                          <span key={s} style={{ display: "flex", alignItems: "center", gap: 6, ...pill(C.ok, C.okTint), padding: "4px 10px" }}>
                            {scopeName(s)}
                            <X className="size-3" style={{ cursor: "pointer" }} onClick={() => disableOfficial(p.key, s)} />
                          </span>
                        ))}
                      </div>}
                </div>

                {/* 启用到新作用域 */}
                <div style={{ marginTop: 14, borderTop: `1px solid ${C.surface2}`, paddingTop: 14 }}>
                  <div style={{ ...eyebrow(6) }}>{t.enableHere}</div>
                  <ScopeCascader scopes={scopes} value={sel} enabledSet={new Set(p.enabled_scopes)}
                    onChange={(v) => setEnScope((m) => ({ ...m, [p.key]: v }))} />
                  <div style={{ marginTop: 10 }}>
                    {selEnabled ? (
                      // 选中的 scope 已启用 → 按钮切为「停用」(启停切换)
                      <Button variant="outline" style={btnGhost} onClick={() => disableOfficial(p.key, sel)}>
                        <X className="size-4 mr-1" />{t.disableBtn}
                      </Button>
                    ) : (
                      <Button style={{ ...btnPrimary, opacity: p.creds_configured ? 1 : 0.5 }} disabled={!p.creds_configured}
                        onClick={() => enableOfficial(p.key)}>
                        <Check className="size-4 mr-1" />{p.creds_configured ? t.enableBtn : t.needCredsFirst}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {official.length === 0 && (
            <div style={{ ...cardStyle, padding: 32, textAlign: "center", fontFamily: FMONO, fontSize: 13, color: C.muted }}>{t.noOfficial}</div>
          )}
        </div>
      )}

      {tab === "git" && <div style={cardStyle}>
        <Table>
          <TableHeader>
            <TableRow style={{ background: C.surface2 }}>
              <TableHead style={thStyle}>{t.thPlugin}</TableHead>
              <TableHead style={thStyle}>{t.thVersion}</TableHead>
              <TableHead style={thStyle}>{t.thScope}</TableHead>
              <TableHead style={thStyle}>{t.thStatus}</TableHead>
              <TableHead style={{ ...thStyle, textAlign: "right" }}>{t.thActions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.35 }}>
                    <span style={{ fontWeight: 600, color: C.ink }}>{s.display_name || s.plugin}</span>
                    {s.display_name
                      ? <span style={{ fontFamily: FMONO, fontSize: 12, color: C.muted }}>{s.plugin}</span>
                      : null}
                  </div>
                </TableCell>
                <TableCell>
                  {s.git_version
                    ? <Badge style={pill(C.signal, C.signalTint)}>{"v" + s.git_version}</Badge>
                    : <span style={{ fontFamily: FMONO, fontSize: 13, color: C.muted }}>—</span>}
                </TableCell>
                <TableCell><Badge style={pill(C.signal, C.signalTint)}>{scopeName(s.scope_ref)}</Badge></TableCell>
                <TableCell><StatusBadge status={s.status} /></TableCell>
                <TableCell>
                  <div className="flex gap-2 justify-end" style={{ flexWrap: "wrap" }}>
                    <Button variant="outline" size="sm" style={btnGhost} onClick={() => setViewing(s)}>{t.view}</Button>
                    <Button variant="outline" size="sm" style={btnGhost} onClick={() => openRename(s)}>{t.setName}</Button>
                    {s.status === "draft" && (
                      <>
                        <Button size="sm" style={{ ...btnPrimary, boxShadow: "none" }} onClick={() => review(s.id, "approve")}>
                          <Check className="size-4 mr-1" />{t.approve}
                        </Button>
                        <Button variant="outline" size="sm" style={btnDanger} onClick={() => remove(s.id)}>
                          <Trash2 className="size-4 mr-1" />{t.delete}
                        </Button>
                      </>
                    )}
                    {s.status === "approved" && (
                      <>
                        <Button size="sm" style={{ ...btnPrimary, boxShadow: "none" }} onClick={() => sync(s.id)}>
                          <RefreshCw className="size-4 mr-1" />{t.update}
                        </Button>
                        <Button variant="outline" size="sm" style={btnGhost} onClick={() => review(s.id, "deprecate")}>
                          <X className="size-4 mr-1" />{t.deprecateBtn}
                        </Button>
                      </>
                    )}
                    {s.status === "deprecated" && (
                      <Button variant="outline" size="sm" style={btnDanger} onClick={() => remove(s.id)}>
                        <Trash2 className="size-4 mr-1" />{t.delete}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {sources.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>
                  <div style={{ fontFamily: FMONO, fontSize: 13, color: C.muted, padding: "32px 0", textAlign: "center" }}>{t.noSources}</div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent style={dialogStyle}>
          <DialogHeader>
            <div style={eyebrow(6)}>{t.inputEyebrow}</div>
            <DialogTitle style={{ fontFamily: FZH, fontWeight: 700, color: C.ink }}>{t.newSourceDialog}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label style={labelStyle}>{t.gitUrl}</Label>
              <div className="flex gap-2">
                <Input style={{ ...inputStyle, flex: 1 }} value={form.git_url} onChange={(e) => setForm({ ...form, git_url: e.target.value })} placeholder="https://github.com/org/repo.git" />
                <Button variant="outline" style={{ ...btnGhost, opacity: discovering ? 0.6 : 1 }} disabled={discovering} onClick={doDiscover}>
                  <RefreshCw className="size-4 mr-1" />{discovering ? t.discovering : t.discover}
                </Button>
              </div>
              {discovered.length > 0 && (
                <div style={{ marginTop: 8, border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
                  {discovered.map((p) => (
                    <div key={p.name} onClick={() => setForm((f) => ({ ...f, plugin: p.name }))}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                        padding: "8px 12px", cursor: "pointer",
                        background: form.plugin === p.name ? C.blueTint : C.surface,
                        borderBottom: `1px solid ${C.surface2}` }}>
                      <span style={{ fontFamily: FMONO, fontSize: 13, color: C.ink }}>{p.name}</span>
                      <Badge style={pill(C.signal, C.signalTint)}>{p.version}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {branches.length > 0 && (
              <div><Label style={labelStyle}>{t.branch}</Label>
                <Select value={form.branch} onValueChange={onBranchChange}>
                  <SelectTrigger style={inputStyle}><SelectValue placeholder={t.selectBranch} /></SelectTrigger>
                  <SelectContent>{branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label style={labelStyle}>{t.pluginPkg}</Label>
              <Input style={inputStyle} value={form.plugin} onChange={(e) => setForm({ ...form, plugin: e.target.value })} placeholder={t.pluginPkgPlaceholder} />
              <div style={{ marginTop: 4, fontFamily: FMONO, fontSize: 12, color: C.muted }}>{t.pluginPkgHint}</div>
            </div>
            <div>
              <Label style={labelStyle}>{t.displayName}</Label>
              <Input style={inputStyle} value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} placeholder={t.displayNamePlaceholder} />
              <div style={{ marginTop: 4, fontFamily: FMONO, fontSize: 12, color: C.muted }}>{t.displayNameHint}</div>
            </div>
            <div><Label style={labelStyle}>{t.thScope}</Label>
              <ScopeCascader scopes={scopes} value={form.scope_ref} onChange={(v) => setForm({ ...form, scope_ref: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={doCreate}>
              <Plus className="size-4 mr-1" />{busy ? t.submitting : t.submitReview}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewing} onOpenChange={(o) => { if (!o) setViewing(null); }}>
        <DialogContent style={{ ...dialogStyle, maxWidth: 560 }}>
          <DialogHeader>
            <div style={eyebrow(6)}>{t.detailEyebrow}</div>
            <DialogTitle style={{ fontFamily: FZH, fontWeight: 700, color: C.ink }}>{viewing?.display_name || viewing?.plugin}</DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-3">
              {[
                { k: t.pluginPkg, v: viewing.plugin, mono: true, breakAll: false },
                { k: t.gitUrl, v: viewing.git_url, mono: true, breakAll: true },
                { k: t.branch, v: viewing.branch || "main", mono: true, breakAll: false },
              ].map((row) => (
                <div key={row.k}>
                  <Label style={labelStyle}>{row.k}</Label>
                  <div style={{ fontFamily: row.mono ? FMONO : FZH, fontSize: 13, color: C.ink,
                    background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "9px 12px",
                    wordBreak: row.breakAll ? "break-all" : "normal" }}>{row.v}</div>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button style={btnPrimary} onClick={() => setViewing(null)}>{t.close}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!credEditing} onOpenChange={(o) => { if (!o) setCredEditing(null); }}>
        <DialogContent style={{ ...dialogStyle, maxWidth: 480 }}>
          <DialogHeader>
            <div style={eyebrow(6)}>{t.officialEyebrow}</div>
            <DialogTitle style={{ fontFamily: FZH, fontWeight: 700, color: C.ink }}>{t.credDialogTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div style={{ fontFamily: FMONO, fontSize: 12, color: C.muted }}>{t.credHint}</div>
            <div>
              <Label style={labelStyle}>{t.credAppId}</Label>
              <Input style={inputStyle} value={credForm.lark_app_id} onChange={(e) => setCredForm({ ...credForm, lark_app_id: e.target.value })} placeholder="cli_xxxxxxxx" />
            </div>
            <div>
              <Label style={labelStyle}>{t.credAppSecret}</Label>
              <Input style={inputStyle} type="password" value={credForm.lark_app_secret} onChange={(e) => setCredForm({ ...credForm, lark_app_secret: e.target.value })} placeholder="••••••••" />
              {credEditing?.creds_configured && (
                <div style={{ fontFamily: FMONO, fontSize: 11, color: C.muted, marginTop: 4 }}>{t.credConfiguredHint}</div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" style={btnGhost} onClick={() => setCredEditing(null)}>{t.cancel}</Button>
            <Button style={{ ...btnPrimary, opacity: credBusy ? 0.6 : 1 }} disabled={credBusy} onClick={saveCreds}>
              <Check className="size-4 mr-1" />{credBusy ? t.saving : t.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renaming} onOpenChange={(o) => { if (!o) setRenaming(null); }}>
        <DialogContent style={{ ...dialogStyle, maxWidth: 480 }}>
          <DialogHeader>
            <div style={eyebrow(6)}>{t.renameEyebrow}</div>
            <DialogTitle style={{ fontFamily: FZH, fontWeight: 700, color: C.ink }}>{t.setDisplayName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div style={{ fontFamily: FMONO, fontSize: 12, color: C.muted }}>
              {t.renamePkgLabel}<span style={{ color: C.ink }}>{renaming?.plugin}</span>{t.renamePkgNote}
            </div>
            <div>
              <Label style={labelStyle}>{t.displayName}</Label>
              <Input style={inputStyle} value={renameVal} onChange={(e) => setRenameVal(e.target.value)}
                placeholder={t.renamePlaceholder} autoFocus
                onKeyDown={(e) => { if (e.key === "Enter" && !renameBusy) doRename(); }} />
              <div style={{ marginTop: 4, fontFamily: FMONO, fontSize: 12, color: C.muted }}>{t.displayNameHint}</div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" style={btnGhost} onClick={() => setRenaming(null)}>{t.cancel}</Button>
            <Button style={{ ...btnPrimary, opacity: renameBusy ? 0.6 : 1 }} disabled={renameBusy} onClick={doRename}>
              <Check className="size-4 mr-1" />{renameBusy ? t.saving : t.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
