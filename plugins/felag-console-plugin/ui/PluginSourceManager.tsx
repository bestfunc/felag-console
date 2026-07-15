import { useState, useCallback, useEffect } from "react";
import { Button, Input, Label, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Badge, toast,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@platform/ui";
import { Plus, RefreshCw, Check, X, Trash2 } from "lucide-react";

const SLUG = "felag-console-plugin";

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

async function callNode<T>(node: string, params: object): Promise<T> {
  const resp = await fetch(`/api/dag/${SLUG}/${node}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
  });
  const env = await resp.json();
  const first = env?.data?.results?.[0];
  if (env?.code !== 0 || first?.error) {
    const raw = first?.error || env?.message || "请求失败";
    const m = String(raw).match(/(?:ValueError|RuntimeError|NodeError|TypeError):\s*([^\n]+)/);
    throw new Error(m ? m[1].trim() : String(raw));
  }
  return first?.output?.result as T;
}

type Scope = { scope_ref: string; label: string; parent_ref?: string | null };
type Source = {
  id: number; git_url: string; plugin: string; display_name?: string | null; scope_ref: string; branch: string; status: string;
  created_by: string; reviewed_by: string | null; created_at?: string; reviewed_at?: string | null;
  git_version?: string | null; sync_requested_at?: string | null;
};

function StatusBadge({ status }: { status: string }) {
  if (status === "approved") return <Badge style={pill(C.ok, C.okTint)}>已通过</Badge>;
  if (status === "deprecated") return <Badge style={pill(C.ng, C.ngTint)}>已停用</Badge>;
  return <Badge style={{ color: C.warnText, background: C.warnBg, border: `1px solid ${C.warnBorder}66`, fontFamily: FMONO, fontSize: 12, borderRadius: 999 }}>待审核</Badge>;
}

// 作用域列式级联(changeOnSelect):点任一节点=直接选中它(总部=全部部门 / 部门=该部门全部岗位 / 岗位=该岗位),
// 含子级的节点点选后右侧自动展开供细选,无需再点三角。右侧件数徽章提示"还能往下选"(用 mono 文本非符号图标,合白名单)。
function ScopeCascader({ scopes, value, onChange }: { scopes: Scope[]; value: string; onChange: (ref: string) => void }) {
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
    if (isDept(ref)) return n.label + (isRoot(n) ? " · 全部部门" : " · 全部岗位");
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
              {col.length === 0 && <div style={{ padding: 10, fontFamily: FMONO, fontSize: 12, color: C.muted }}>（空）</div>}
              {col.map((n) => {
                const kids = childrenOf(n.scope_ref);
                const dept = isDept(n.scope_ref);
                const selected = value === n.scope_ref;
                const opened = path[ci] === n.scope_ref;
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
                          {isRoot(n) ? "选中=全部部门" : "选中=全部岗位"}
                        </span>
                      )}
                    </span>
                    {kids.length > 0 && (
                      <span style={{ flexShrink: 0, fontFamily: FMONO, fontSize: 12, letterSpacing: ".02em",
                        color: opened ? C.signal : C.muted, background: opened ? C.blueTint : C.surface2,
                        border: `1px solid ${opened ? C.signal + "55" : C.line}`, borderRadius: 999, padding: "1px 7px" }}>
                        {kids.length} {isRoot(n) ? "部门" : "岗位"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 6, fontFamily: FMONO, fontSize: 12, color: value ? C.signal : C.muted }}>
        {value ? `已选：${selLabel(value)}` : "点部门=选其“全部岗位”，含下级会自动展开右侧供细选"}
      </div>
    </div>
  );
}

export default function PluginSourceManager() {
  const [sources, setSources] = useState<Source[]>([]);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ git_url: "", plugin: "", display_name: "", scope_ref: "", branch: "" });
  // 设置名称（只改展示名）：编辑中的源 + 输入值
  const [renaming, setRenaming] = useState<Source | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [discovered, setDiscovered] = useState<{ name: string; version: string }[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const ctx = await callNode<{ manageable_scopes: Scope[] }>("actor_context", {});
      setScopes(ctx.manageable_scopes);
      const r = await callNode<{ sources: Source[] }>("plugin_source_list", {});
      setSources(r.sources);
    } catch (e: any) { toast.error(e.message); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // scope_ref（dept:12 / pos:1）→ 组织名，用 actor_context 拿到的可管作用域映射；无匹配回退原码
  const scopeName = (ref: string) => scopes.find((s) => s.scope_ref === ref)?.label || ref;

  function openCreate() {
    setForm({ git_url: "", plugin: "", display_name: "", scope_ref: "", branch: "" });
    setDiscovered([]); setBranches([]); setCreateOpen(true);
  }

  // 枚举某分支下的插件(填探测结果提示;枚举=下载整包,大仓/慢网可能软失败,此时插件名手填即可)
  async function enumerate(git_url: string, branch: string) {
    const r = await callNode<{ plugins?: { name: string; version: string }[]; plugins_error?: string }>("plugin_discover", { git_url, branch });
    const plugins = r.plugins ?? [];
    setDiscovered(plugins);
    if (r.plugins_error) toast.error(r.plugins_error);
    else if (plugins.length === 0) toast.error(`分支 ${branch} 下未发现可用插件`);
  }

  // 探测:先列所有分支(git smart-HTTP,不吃 REST 限流)→ 选默认分支 → 枚举该分支插件;分支/插件名仍可手填
  async function doDiscover() {
    const git_url = form.git_url.trim();
    if (!git_url) { toast.error("请先填 Git 地址"); return; }
    setDiscovering(true);
    try {
      const r = await callNode<{ branches: string[]; default_branch: string }>("plugin_discover", { git_url });
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
    if (!git_url) { toast.error("请填 git_url"); return; }
    if (!plugin) { toast.error("请填 plugin"); return; }
    if (!form.scope_ref) { toast.error("请选择作用域"); return; }
    setBusy(true);
    try {
      await callNode("plugin_source_create", { git_url, plugin, display_name, scope_ref: form.scope_ref, branch });
      toast.success("已提交待审核"); setCreateOpen(false); refresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function review(source_id: number, action: "approve" | "deprecate") {
    try {
      await callNode("plugin_source_review", { source_id, action });
      toast.success(action === "approve" ? "已通过" : "已停用");
      refresh();
    } catch (e: any) { toast.error(e.message); }
  }

  async function remove(source_id: number) {
    try {
      await callNode("plugin_source_delete", { source_id });
      toast.success("已删除");
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
      await callNode("plugin_source_rename", { source_id: renaming.id, display_name: renameVal.trim() });
      toast.success(renaming.status === "approved" ? "已更新展示名，约 30 秒内下发到客户端" : "已更新展示名");
      setRenaming(null); refresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setRenameBusy(false); }
  }

  // 请求立即同步:置 sync_requested_at,felag-server 快轮询(约 30s)拾取后重摄该源
  async function sync(source_id: number) {
    try {
      await callNode("plugin_source_sync", { source_id });
      toast.success("已请求同步，约 30 秒内 felag-server 会重新摄取该源");
      refresh();
    } catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="px-8 py-6 space-y-5" style={{ background: AURORA, minHeight: "100%", fontFamily: FZH }}>
      <div className="flex items-end justify-between">
        <div>
          <div style={eyebrow(4)}>PLUGIN SOURCE GOVERNANCE</div>
          <h1 style={{ fontFamily: FZH, fontWeight: 800, fontSize: 26, color: C.ink, letterSpacing: "-0.02em" }}>插件源管理</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" style={btnGhost} onClick={refresh}><RefreshCw className="size-4 mr-1" />刷新</Button>
          <Button style={btnPrimary} onClick={openCreate}><Plus className="size-4 mr-1" />新建源</Button>
        </div>
      </div>

      <div style={cardStyle}>
        <Table>
          <TableHeader>
            <TableRow style={{ background: C.surface2 }}>
              <TableHead style={thStyle}>Git 地址</TableHead><TableHead style={thStyle}>插件</TableHead>
              <TableHead style={thStyle}>版本</TableHead>
              <TableHead style={thStyle}>分支</TableHead>
              <TableHead style={thStyle}>作用域</TableHead><TableHead style={thStyle}>状态</TableHead>
              <TableHead style={thStyle}></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.map((s) => (
              <TableRow key={s.id}>
                <TableCell style={{ fontFamily: FMONO, fontSize: 13, color: C.ink }}>{s.git_url}</TableCell>
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
                <TableCell><Badge style={pill(C.body, C.surface2)}>{s.branch || "main"}</Badge></TableCell>
                <TableCell><Badge style={pill(C.signal, C.signalTint)}>{scopeName(s.scope_ref)}</Badge></TableCell>
                <TableCell><StatusBadge status={s.status} /></TableCell>
                <TableCell>
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" size="sm" style={btnGhost} onClick={() => openRename(s)}>设置名称</Button>
                    {s.status === "draft" && (
                      <>
                        <Button size="sm" style={{ ...btnPrimary, boxShadow: "none" }} onClick={() => review(s.id, "approve")}>
                          <Check className="size-4 mr-1" />审核通过
                        </Button>
                        <Button variant="outline" size="sm" style={btnDanger} onClick={() => remove(s.id)}>
                          <Trash2 className="size-4 mr-1" />删除
                        </Button>
                      </>
                    )}
                    {s.status === "approved" && (
                      <>
                        <Button size="sm" style={{ ...btnPrimary, boxShadow: "none" }} onClick={() => sync(s.id)}>
                          <RefreshCw className="size-4 mr-1" />更新
                        </Button>
                        <Button variant="outline" size="sm" style={btnGhost} onClick={() => review(s.id, "deprecate")}>
                          <X className="size-4 mr-1" />停用
                        </Button>
                      </>
                    )}
                    {s.status === "deprecated" && (
                      <Button variant="outline" size="sm" style={btnDanger} onClick={() => remove(s.id)}>
                        <Trash2 className="size-4 mr-1" />删除
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {sources.length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>
                  <div style={{ fontFamily: FMONO, fontSize: 13, color: C.muted, padding: "32px 0", textAlign: "center" }}>暂无插件源</div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent style={dialogStyle}>
          <DialogHeader>
            <div style={eyebrow(6)}>INPUT · 输入</div>
            <DialogTitle style={{ fontFamily: FZH, fontWeight: 700, color: C.ink }}>新建插件源</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label style={labelStyle}>Git 地址</Label>
              <div className="flex gap-2">
                <Input style={{ ...inputStyle, flex: 1 }} value={form.git_url} onChange={(e) => setForm({ ...form, git_url: e.target.value })} placeholder="https://github.com/org/repo.git" />
                <Button variant="outline" style={{ ...btnGhost, opacity: discovering ? 0.6 : 1 }} disabled={discovering} onClick={doDiscover}>
                  <RefreshCw className="size-4 mr-1" />{discovering ? "探测中…" : "探测"}
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
              <div><Label style={labelStyle}>分支</Label>
                <Select value={form.branch} onValueChange={onBranchChange}>
                  <SelectTrigger style={inputStyle}><SelectValue placeholder="选择分支" /></SelectTrigger>
                  <SelectContent>{branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label style={labelStyle}>插件包名</Label>
              <Input style={inputStyle} value={form.plugin} onChange={(e) => setForm({ ...form, plugin: e.target.value })} placeholder="插件仓库里的技术包名（可手填，或点上方探测结果）" />
              <div style={{ marginTop: 4, fontFamily: FMONO, fontSize: 12, color: C.muted }}>须与仓库 plugin.json 的 name 一致，摄取时会校验，不是给人看的名字</div>
            </div>
            <div>
              <Label style={labelStyle}>展示名</Label>
              <Input style={inputStyle} value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} placeholder="给人看的友好名（选填，如“智能质量”）；空则用包名" />
              <div style={{ marginTop: 4, fontFamily: FMONO, fontSize: 12, color: C.muted }}>数字员工客户端的连接器卡片会显示这个名字</div>
            </div>
            <div><Label style={labelStyle}>作用域</Label>
              <ScopeCascader scopes={scopes} value={form.scope_ref} onChange={(v) => setForm({ ...form, scope_ref: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={doCreate}>
              <Plus className="size-4 mr-1" />{busy ? "提交中…" : "提交待审核"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renaming} onOpenChange={(o) => { if (!o) setRenaming(null); }}>
        <DialogContent style={{ ...dialogStyle, maxWidth: 480 }}>
          <DialogHeader>
            <div style={eyebrow(6)}>RENAME · 设置名称</div>
            <DialogTitle style={{ fontFamily: FZH, fontWeight: 700, color: C.ink }}>设置展示名</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div style={{ fontFamily: FMONO, fontSize: 12, color: C.muted }}>
              插件包名 <span style={{ color: C.ink }}>{renaming?.plugin}</span> · 仅改展示名，其它不变
            </div>
            <div>
              <Label style={labelStyle}>展示名</Label>
              <Input style={inputStyle} value={renameVal} onChange={(e) => setRenameVal(e.target.value)}
                placeholder="给人看的友好名（留空则用包名）" autoFocus
                onKeyDown={(e) => { if (e.key === "Enter" && !renameBusy) doRename(); }} />
              <div style={{ marginTop: 4, fontFamily: FMONO, fontSize: 12, color: C.muted }}>数字员工客户端的连接器卡片会显示这个名字</div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" style={btnGhost} onClick={() => setRenaming(null)}>取消</Button>
            <Button style={{ ...btnPrimary, opacity: renameBusy ? 0.6 : 1 }} disabled={renameBusy} onClick={doRename}>
              <Check className="size-4 mr-1" />{renameBusy ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
