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
  fontFamily: FZH,
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

type Scope = { scope_ref: string; label: string };
type Source = {
  id: number; git_url: string; plugin: string; scope_ref: string; status: string;
  created_by: string; reviewed_by: string | null; created_at?: string; reviewed_at?: string | null;
};

function StatusBadge({ status }: { status: string }) {
  if (status === "approved") return <Badge style={pill(C.ok, C.okTint)}>已通过</Badge>;
  if (status === "deprecated") return <Badge style={pill(C.ng, C.ngTint)}>已停用</Badge>;
  return <Badge style={{ color: C.warnText, background: C.warnBg, border: `1px solid ${C.warnBorder}66`, fontFamily: FMONO, fontSize: 12, borderRadius: 999 }}>待审核</Badge>;
}

export default function PluginSourceManager() {
  const [sources, setSources] = useState<Source[]>([]);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ git_url: "", plugin: "", scope_ref: "" });
  const [busy, setBusy] = useState(false);
  const [discovered, setDiscovered] = useState<{ name: string; version: string }[]>([]);
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
    setForm({ git_url: "", plugin: "", scope_ref: "" }); setDiscovered([]); setCreateOpen(true);
  }

  // 探测:拉 git 仓枚举可选插件作提示;插件名仍可手填,点列表项即填入
  async function doDiscover() {
    const git_url = form.git_url.trim();
    if (!git_url) { toast.error("请先填 Git 地址"); return; }
    setDiscovering(true);
    try {
      const r = await callNode<{ plugins: { name: string; version: string }[] }>("plugin_discover", { git_url });
      setDiscovered(r.plugins);
      if (r.plugins.length === 0) toast.error("该仓下未发现可用插件");
    } catch (e: any) { toast.error(e.message); }
    finally { setDiscovering(false); }
  }

  async function doCreate() {
    const git_url = form.git_url.trim();
    const plugin = form.plugin.trim();
    if (!git_url) { toast.error("请填 git_url"); return; }
    if (!plugin) { toast.error("请填 plugin"); return; }
    if (!form.scope_ref) { toast.error("请选择作用域"); return; }
    setBusy(true);
    try {
      await callNode("plugin_source_create", { git_url, plugin, scope_ref: form.scope_ref });
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
              <TableHead style={thStyle}>作用域</TableHead><TableHead style={thStyle}>状态</TableHead>
              <TableHead style={thStyle}></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.map((s) => (
              <TableRow key={s.id}>
                <TableCell style={{ fontFamily: FMONO, fontSize: 13, color: C.ink }}>{s.git_url}</TableCell>
                <TableCell style={{ fontWeight: 500, color: C.ink }}>{s.plugin}</TableCell>
                <TableCell><Badge style={pill(C.signal, C.signalTint)}>{scopeName(s.scope_ref)}</Badge></TableCell>
                <TableCell><StatusBadge status={s.status} /></TableCell>
                <TableCell>
                  <div className="flex gap-2 justify-end">
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
                      <Button variant="outline" size="sm" style={btnGhost} onClick={() => review(s.id, "deprecate")}>
                        <X className="size-4 mr-1" />停用
                      </Button>
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
                <TableCell colSpan={5}>
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
            <div><Label style={labelStyle}>插件名</Label><Input style={inputStyle} value={form.plugin} onChange={(e) => setForm({ ...form, plugin: e.target.value })} placeholder="mcp 插件名（可手填，或点上方探测结果）" /></div>
            <div><Label style={labelStyle}>作用域</Label>
              <Select value={form.scope_ref} onValueChange={(v) => setForm({ ...form, scope_ref: v })}>
                <SelectTrigger style={inputStyle}><SelectValue placeholder="选择作用域" /></SelectTrigger>
                <SelectContent>{scopes.map((s) => <SelectItem key={s.scope_ref} value={s.scope_ref}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={doCreate}>
              <Plus className="size-4 mr-1" />{busy ? "提交中…" : "提交待审核"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
