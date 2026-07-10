import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Button, Input, Label, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Badge, toast,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@platform/ui";
import { Plus, RefreshCw, Check, X, Trash2, Upload, FileText, FolderOpen } from "lucide-react";

const SLUG = "felag-console";

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

// ── 浏览器端把「多文件 / 整目录」打包成 tar.gz（顶层目录 == skill 名，匹配后端 pkgvalidate）──
// tar 字节布局已用后端 validate_package 在 Python 里验通过后照搬（ustar 头 + checksum）。
type Picked = { rel: string; file: File };

function octalField(n: number, width: number): Uint8Array {
  return new TextEncoder().encode(n.toString(8).padStart(width - 1, "0") + "\0");
}
function tarHeader(name: string, size: number): Uint8Array {
  const nb = new TextEncoder().encode(name);
  if (nb.length > 100) throw new Error(`路径过长(>100字节)，无法打包：${name}`);
  const h = new Uint8Array(512);
  h.set(nb, 0);
  h.set(octalField(0o644, 8), 100);   // mode
  h.set(octalField(0, 8), 108);       // uid
  h.set(octalField(0, 8), 116);       // gid
  h.set(octalField(size, 12), 124);   // size
  h.set(octalField(0, 12), 136);      // mtime
  for (let i = 148; i < 156; i++) h[i] = 0x20;  // checksum 占位 = 8 空格
  h[156] = 0x30;                      // typeflag '0' = 普通文件
  h.set(new TextEncoder().encode("ustar\0"), 257);
  h.set(new TextEncoder().encode("00"), 263);
  let chk = 0; for (let i = 0; i < 512; i++) chk += h[i];
  h.set(new TextEncoder().encode(chk.toString(8).padStart(6, "0") + "\0 "), 148);
  return h;
}
function buildTar(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const f of files) {
    parts.push(tarHeader(f.name, f.data.length), f.data);
    const rem = f.data.length % 512;
    if (rem) parts.push(new Uint8Array(512 - rem));
  }
  parts.push(new Uint8Array(1024));  // 两个全零块 = EOF
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0; for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}
function toB64(data: Uint8Array): string {
  let s = ""; const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) s += String.fromCharCode(...data.subarray(i, i + chunk));
  return btoa(s);
}
// 拖拽：用 webkitGetAsEntry 递归目录，兼容拖文件夹 / 多文件
function readAllEntries(reader: any): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const all: any[] = [];
    const pump = () => reader.readEntries((batch: any[]) => {
      if (!batch.length) return resolve(all);
      all.push(...batch); pump();
    }, reject);
    pump();
  });
}
async function filesFromDrop(dt: DataTransfer): Promise<Picked[]> {
  const entries = Array.from(dt.items).map((it) => (it as any).webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return Array.from(dt.files).map((f) => ({ rel: f.name, file: f }));
  const out: Picked[] = [];
  const walk = async (entry: any, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const f: File = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ rel: prefix + entry.name, file: f });
    } else if (entry.isDirectory) {
      for (const e of await readAllEntries(entry.createReader())) await walk(e, prefix + entry.name + "/");
    }
  };
  for (const e of entries) await walk(e, "");
  return out;
}
function filesFromInput(list: FileList | null): Picked[] {
  return Array.from(list || []).map((f) => ({ rel: (f as any).webkitRelativePath || f.name, file: f }));
}

// ── 轻量 Markdown 渲染（无第三方库；先转义 HTML 再套 Ice Blue，dangerouslySetInnerHTML 前已防注入）──
function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function renderMd(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inCode = false, code: string[] = [], list: "ul" | "ol" | null = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const inline = (t: string) => escHtml(t)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, txt, url) =>
      /^https?:\/\//.test(url) ? `<a href="${escHtml(url)}" target="_blank" rel="noopener">${txt}</a>` : txt);
  // 表格：分隔行（|---|:--:|）判定 + 单元格拆分
  const isSep = (s: string) => s.includes("-") && /^[\s|:-]+$/.test(s.trim());
  const cells = (s: string) => s.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      if (inCode) { out.push(`<pre class="mc">${escHtml(code.join("\n"))}</pre>`); code = []; inCode = false; }
      else { closeList(); inCode = true; }
      continue;
    }
    if (inCode) { code.push(line); continue; }
    // 表格：本行含 | 且下一行是分隔行
    if (/^\s*\|.*\|/.test(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
      closeList();
      const head = cells(line);
      const body: string[][] = [];
      let j = i + 2;
      while (j < lines.length && /\|/.test(lines[j]) && !isSep(lines[j]) && lines[j].trim() !== "") {
        body.push(cells(lines[j])); j++;
      }
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>` +
        body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("") +
        `</tbody></table>`,
      );
      i = j - 1;
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    const ul = line.match(/^\s*[-*]\s+(.*)$/), ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ul) { if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; } out.push(`<li>${inline(ul[1])}</li>`); continue; }
    if (ol) { if (list !== "ol") { closeList(); out.push("<ol>"); list = "ol"; } out.push(`<li>${inline(ol[1])}</li>`); continue; }
    if (/^\s*$/.test(line)) { closeList(); continue; }
    if (/^\s*>/.test(line)) { closeList(); out.push(`<blockquote>${inline(line.replace(/^\s*>\s?/, ""))}</blockquote>`); continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { closeList(); out.push("<hr/>"); continue; }
    closeList(); out.push(`<p>${inline(line)}</p>`);
  }
  if (inCode) out.push(`<pre class="mc">${escHtml(code.join("\n"))}</pre>`);
  closeList();
  return out.join("\n");
}
const MD_CSS = `
.femd{color:#334155;font-size:14px;line-height:1.75;font-family:${FZH};overflow-wrap:anywhere;word-break:break-word;min-width:0}
.femd *{max-width:100%;box-sizing:border-box}
.femd h1,.femd h2,.femd h3,.femd h4{color:#071225;font-weight:700;margin:.9em 0 .4em;line-height:1.3}
.femd h1{font-size:20px}.femd h2{font-size:17px}.femd h3{font-size:15px}.femd h4{font-size:14px}
.femd p{margin:.5em 0}.femd ul,.femd ol{margin:.4em 0;padding-left:1.4em}.femd li{margin:.2em 0}
.femd a{color:#0A84FF;text-decoration:underline}
.femd code{background:rgba(10,132,255,.08);color:#0A84FF;padding:.1em .35em;border-radius:5px;font-family:${FMONO};font-size:.9em}
.femd pre.mc{background:#F1F6FD;border:1px solid #D8E2F0;border-radius:10px;padding:12px;overflow:auto;font-family:${FMONO};font-size:13px;line-height:1.6}
.femd pre.mc code{background:none;color:#334155;padding:0}
.femd blockquote{border-left:3px solid #0A84FF;margin:.5em 0;padding:.1em 0 .1em .8em;color:#64748B}
.femd hr{border:none;border-top:1px solid #D8E2F0;margin:.8em 0}
.femd strong{color:#071225}
.femd table{display:block;width:max-content;max-width:100%;overflow-x:auto;border-collapse:collapse;margin:.6em 0;font-size:13px}
.femd th,.femd td{border:1px solid #D8E2F0;padding:5px 10px;text-align:left;vertical-align:top}
.femd th{background:#F1F6FD;color:#071225;font-weight:700;white-space:nowrap}
.femd td{color:#334155}`;

type Scope = { scope_ref: string; label: string; parent_ref?: string | null };
type Skill = { id: number; name: string; scope_ref: string; status: string; current_version_id: number | null; pending_count: number };
type Version = { id: number; version: string; review_status: string; self_review: boolean; uploaded_by: string;
  size_bytes?: number; sha256?: string; created_at?: string; published_at?: string; reviewed_by?: string };
type PkgFile = { path: string; size: number; is_text: boolean; text?: string };

function StatusBadge({ status }: { status: string }) {
  return status === "deprecated"
    ? <Badge style={pill(C.ng, C.ngTint)}>已下架</Badge>
    : <Badge style={pill(C.ok, C.okTint)}>正常</Badge>;
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

export default function SkillManager() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [detail, setDetail] = useState<{ skill: Skill; versions: Version[] } | null>(null);
  const [selVer, setSelVer] = useState<Version | null>(null);
  const [verFiles, setVerFiles] = useState<PkgFile[] | null>(null);
  const [selFile, setSelFile] = useState<PkgFile | null>(null);
  const [mdMode, setMdMode] = useState<"pretty" | "source">("pretty");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", scope_ref: "", version: "1.0.0" });
  const [picked, setPicked] = useState<Picked[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const ctx = await callNode<{ manageable_scopes: Scope[] }>("actor_context", {});
      setScopes(ctx.manageable_scopes);
      const r = await callNode<{ skills: Skill[] }>("skill_list", {});
      setSkills(r.skills);
    } catch (e: any) { toast.error(e.message); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // 合并新选文件（按 rel 去重）；skill 名为空时用拖入目录的顶层名自动带出
  function addPicked(items: Picked[]) {
    if (!items.length) return;
    setPicked((prev) => {
      const map = new Map(prev.map((p) => [p.rel, p]));
      for (const it of items) map.set(it.rel, it);
      return Array.from(map.values());
    });
    setForm((f) => {
      if (f.name.trim()) return f;
      const withDir = items.find((it) => it.rel.includes("/"));
      return withDir ? { ...f, name: withDir.rel.split("/")[0] } : f;
    });
  }
  function openCreate() {
    setForm({ name: "", scope_ref: "", version: "1.0.0" }); setPicked([]); setCreateOpen(true);
  }

  // scope_ref（dept:12 / pos:1）→ 组织名，用 actor_context 拿到的可管作用域映射；无匹配回退原码
  const scopeName = (ref: string) => scopes.find((s) => s.scope_ref === ref)?.label || ref;

  async function loadVerFiles(v: Version) {
    setSelVer(v); setVerFiles(null); setSelFile(null);
    try {
      const r = await callNode<{ files: PkgFile[] }>("version_files", { version_id: v.id });
      setVerFiles(r.files);
      const md = r.files.find((f) => /(^|\/)SKILL\.md$/i.test(f.path));
      setSelFile(md || r.files.find((f) => f.is_text) || r.files[0] || null);
      setMdMode("pretty");
    } catch (e: any) { toast.error(e.message); }
  }
  async function openDetail(id: number) {
    try {
      const d = await callNode<{ skill: Skill; versions: Version[] }>("skill_detail", { skill_id: id });
      setDetail(d);
      if (d.versions[0]) loadVerFiles(d.versions[0]); else { setSelVer(null); setVerFiles(null); setSelFile(null); }
    } catch (e: any) { toast.error(e.message); }
  }
  const isMd = (p: string) => /\.md$/i.test(p);
  // 缓存 markdown 渲染，避免每次 re-render（点文件/开下拉）都重跑正则解析 → 卡顿
  const mdHtml = useMemo(
    () => (selFile && isMd(selFile.path) && selFile.is_text && mdMode === "pretty" ? renderMd(selFile.text || "") : ""),
    [selFile, mdMode],
  );
  async function doCreate() {
    const name = form.name.trim();
    if (!name) { toast.error("请填 skill 名称"); return; }
    if (!form.scope_ref) { toast.error("请选择作用域"); return; }
    if (!picked.length) { toast.error("请拖入 skill 目录或文件"); return; }
    setBusy(true);
    try {
      // 全部文件重挂到 ${name}/ 下（顶层目录 == skill 名，后端强校验）
      const files: { name: string; data: Uint8Array }[] = [];
      for (const { rel, file } of picked) {
        const inner = rel.includes("/") ? rel.slice(rel.indexOf("/") + 1) : rel;
        files.push({ name: `${name}/${inner}`, data: new Uint8Array(await file.arrayBuffer()) });
      }
      // 只暂存未压缩 tar（不 gzip）；审核通过时后端才打包成分发用 tar.gz
      const tar = buildTar(files);
      if (tar.length > 8 * 1024 * 1024) throw new Error(`文件总量 ${(tar.length / 1048576).toFixed(2)}MB 超 8MB 上限`);
      await callNode("skill_create", { name, scope_ref: form.scope_ref, version: form.version, content_b64: toB64(tar) });
      toast.success(`已提交待审核（${files.length} 个文件）`); setCreateOpen(false); refresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }
  async function review(version_id: number, action: "approve" | "reject") {
    try { await callNode("skill_review", { version_id, action }); toast.success(action === "approve" ? "已发布" : "已驳回");
      if (detail) openDetail(detail.skill.id); refresh(); }
    catch (e: any) { toast.error(e.message); }
  }
  async function deprecate(id: number) {
    try { await callNode("skill_deprecate", { skill_id: id }); toast.success("已下架"); setDetail(null); refresh(); }
    catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="px-8 py-6 space-y-5" style={{ background: AURORA, minHeight: "100%", fontFamily: FZH }}>
      <div className="flex items-end justify-between">
        <div>
          <div style={eyebrow(4)}>SKILL GOVERNANCE</div>
          <h1 style={{ fontFamily: FZH, fontWeight: 800, fontSize: 26, color: C.ink, letterSpacing: "-0.02em" }}>Skill 管理</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" style={btnGhost} onClick={refresh}><RefreshCw className="size-4 mr-1" />刷新</Button>
          <Button style={btnPrimary} onClick={openCreate}><Plus className="size-4 mr-1" />新建 Skill</Button>
        </div>
      </div>

      <div style={cardStyle}>
        <Table>
          <TableHeader>
            <TableRow style={{ background: C.surface2 }}>
              <TableHead style={thStyle}>名称</TableHead><TableHead style={thStyle}>作用域</TableHead>
              <TableHead style={thStyle}>状态</TableHead><TableHead style={thStyle}>待审</TableHead>
              <TableHead style={thStyle}></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {skills.map((s) => (
              <TableRow key={s.id}>
                <TableCell style={{ fontWeight: 500, color: C.ink }}>{s.name}</TableCell>
                <TableCell><Badge style={pill(C.signal, C.signalTint)}>{scopeName(s.scope_ref)}</Badge></TableCell>
                <TableCell><StatusBadge status={s.status} /></TableCell>
                <TableCell>
                  {s.pending_count > 0
                    ? <Badge style={{ color: C.warnText, background: C.warnBg, border: `1px solid ${C.warnBorder}66`, fontFamily: FMONO, fontSize: 12, borderRadius: 999 }}>{s.pending_count} 待审</Badge>
                    : <span style={{ color: C.muted }}>—</span>}
                </TableCell>
                <TableCell>
                  <div className="flex gap-2 justify-end">
                    {s.pending_count > 0 && (
                      <Button size="sm" style={{ ...btnPrimary, boxShadow: "none" }} onClick={() => openDetail(s.id)}>
                        <Check className="size-4 mr-1" />审核
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" style={{ color: C.signal, fontFamily: FZH, fontWeight: 600 }} onClick={() => openDetail(s.id)}>详情</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {skills.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>
                  <div style={{ fontFamily: FMONO, fontSize: 13, color: C.muted, padding: "32px 0", textAlign: "center" }}>暂无 Skill</div>
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
            <DialogTitle style={{ fontFamily: FZH, fontWeight: 700, color: C.ink }}>新建 Skill</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label style={labelStyle}>名称</Label><Input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="skill 目录名，如 ops-runbook" /></div>
            <div><Label style={labelStyle}>作用域</Label>
              <ScopeCascader scopes={scopes} value={form.scope_ref} onChange={(v) => setForm({ ...form, scope_ref: v })} />
            </div>
            <div><Label style={labelStyle}>版本号</Label><Input style={inputStyle} value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} /></div>

            <div>
              <Label style={labelStyle}>SKILL 文件（一个目录 / 多文件，浏览器自动打包）</Label>
              {/* 拖拽区：拖目录或多文件到此，或点击选择 */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={async (e) => { e.preventDefault(); setDragOver(false); addPicked(await filesFromDrop(e.dataTransfer)); }}
                onClick={() => fileRef.current?.click()}
                style={{
                  border: `1.5px dashed ${dragOver ? C.signal : C.line}`, borderRadius: 16,
                  background: dragOver ? C.blueTint : C.surface2, padding: "22px 16px",
                  textAlign: "center", cursor: "pointer", transition: "all .15s",
                }}
              >
                <Upload className="size-6 mx-auto" style={{ color: C.signal }} />
                <div style={{ color: C.body, fontFamily: FZH, fontSize: 14, marginTop: 8 }}>拖拽 skill 目录或多个文件到此</div>
                <div style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
                  或点击选择文件 ·{" "}
                  <span style={{ color: C.signal, textDecoration: "underline" }}
                        onClick={(e) => { e.stopPropagation(); dirRef.current?.click(); }}>选择整个目录</span>
                </div>
              </div>
              <input ref={fileRef} type="file" multiple style={{ display: "none" }}
                     onChange={(e) => { addPicked(filesFromInput(e.target.files)); e.currentTarget.value = ""; }} />
              <input ref={dirRef} type="file" style={{ display: "none" }}
                     {...({ webkitdirectory: "", directory: "" } as any)}
                     onChange={(e) => { addPicked(filesFromInput(e.target.files)); e.currentTarget.value = ""; }} />

              {picked.length > 0 && (
                <div style={{ marginTop: 8, border: `1px solid ${C.line}`, borderRadius: 14, background: C.surface, overflow: "hidden" }}>
                  <div className="flex items-center justify-between" style={{ padding: "8px 12px", borderBottom: `1px solid ${C.line}` }}>
                    <span style={{ fontFamily: FMONO, fontSize: 12, color: C.muted }}>{picked.length} 个文件</span>
                    <button onClick={() => setPicked([])} style={{ fontFamily: FZH, fontSize: 12, color: C.ng, background: "none", border: "none", cursor: "pointer" }}>清空</button>
                  </div>
                  <div style={{ maxHeight: 132, overflowY: "auto" }}>
                    {picked.map((p) => (
                      <div key={p.rel} className="flex items-center justify-between" style={{ padding: "5px 12px", fontSize: 13, color: C.body }}>
                        <span className="flex items-center gap-1.5" style={{ minWidth: 0 }}>
                          {p.rel.includes("/") ? <FolderOpen className="size-3.5 shrink-0" style={{ color: C.muted }} /> : <FileText className="size-3.5 shrink-0" style={{ color: C.muted }} />}
                          <span style={{ fontFamily: FMONO, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.rel}</span>
                        </span>
                        <button onClick={() => setPicked((prev) => prev.filter((x) => x.rel !== p.rel))}
                                style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, lineHeight: 1 }}><X className="size-3.5" /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={doCreate}>
              <Upload className="size-4 mr-1" />{busy ? "提交中…" : "提交待审核"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent style={{ ...dialogStyle, width: "90vw", maxWidth: 880, boxSizing: "border-box", overflowX: "hidden" }}>
          <style>{MD_CSS}</style>
          <DialogHeader>
            <div style={eyebrow(6)}>DETAIL · 详情</div>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <DialogTitle style={{ fontFamily: FZH, fontWeight: 700, color: C.ink }}>{detail?.skill.name}</DialogTitle>
              {/* 版本选择器：审核和文档同屏，换版本即换文档 */}
              <Select value={selVer ? String(selVer.id) : ""}
                      onValueChange={(v) => { const ver = detail?.versions.find((x) => String(x.id) === v); if (ver) loadVerFiles(ver); }}>
                <SelectTrigger style={{ ...inputStyle, width: 240 }}><SelectValue placeholder="选择版本" /></SelectTrigger>
                <SelectContent>
                  {detail?.versions.map((v) => (
                    <SelectItem key={v.id} value={String(v.id)}>
                      {v.version} · {v.review_status === "published" ? "已发布" : v.review_status === "rejected" ? "已驳回" : "待审"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </DialogHeader>

          {selVer && (
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {([
                ["状态", selVer.review_status === "published" ? "已发布" : selVer.review_status === "rejected" ? "已驳回" : "待审"],
                ["文件数", verFiles ? String(verFiles.length) : "…"],
                ["大小", selVer.size_bytes != null ? `${(selVer.size_bytes / 1024).toFixed(1)} KB` : "—"],
                ["上传人", selVer.uploaded_by || "—"],
                ["时间", (selVer.created_at || "").replace("T", " ").slice(0, 16) || "—"],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k}>
                  <span style={{ fontFamily: FMONO, fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: C.muted }}>{k}</span>
                  <span style={{ marginLeft: 6, fontSize: 13, color: C.ink }}>{v}</span>
                </div>
              ))}
            </div>
          )}

          {/* 文件列表（左，支持多文件）+ 内容（右，.md 可美化/源码切换）*/}
          {verFiles === null ? (
            <div style={{ fontFamily: FMONO, fontSize: 13, color: C.muted, padding: "40px 0", textAlign: "center" }}>加载中…</div>
          ) : (
            <div className="flex gap-3" style={{ height: "52vh", minHeight: 260, minWidth: 0, width: "100%", overflow: "hidden" }}>
              <div style={{ width: 220, flexShrink: 0, border: `1px solid ${C.line}`, borderRadius: 14, background: C.surface, overflowY: "auto" }}>
                {verFiles.length === 0 && <div style={{ padding: 12, fontSize: 13, color: C.muted }}>空包</div>}
                {verFiles.map((f) => (
                  <div key={f.path} onClick={() => setSelFile(f)} className="flex items-center gap-1.5"
                       style={{ padding: "7px 10px", cursor: "pointer", fontSize: 13, minWidth: 0,
                                background: selFile?.path === f.path ? C.blueTint : "transparent",
                                color: selFile?.path === f.path ? C.ink : C.body }}>
                    <FileText className="size-3.5 shrink-0" style={{ color: selFile?.path === f.path ? C.signal : C.muted }} />
                    <span style={{ fontFamily: FMONO, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.path}</span>
                  </div>
                ))}
              </div>

              <div className="flex flex-col" style={{ flex: 1, minWidth: 0, border: `1px solid ${C.line}`, borderRadius: 14, background: C.surface2, overflow: "hidden" }}>
                <div className="flex items-center justify-between gap-2" style={{ padding: "7px 12px", borderBottom: `1px solid ${C.line}`, background: C.surface }}>
                  <span style={{ fontFamily: FMONO, fontSize: 12, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selFile?.path || "—"}</span>
                  {selFile && isMd(selFile.path) && selFile.is_text && (
                    <div className="flex" style={{ border: `1px solid ${C.line}`, borderRadius: 999, overflow: "hidden", flexShrink: 0 }}>
                      {(["pretty", "source"] as const).map((m) => (
                        <button key={m} onClick={() => setMdMode(m)}
                                style={{ padding: "3px 12px", fontSize: 12, fontFamily: FZH, border: "none", cursor: "pointer",
                                         background: mdMode === m ? C.signal : "transparent", color: mdMode === m ? "#fff" : C.body }}>
                          {m === "pretty" ? "美化" : "源码"}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 14 }}>
                  {!selFile ? (
                    <div style={{ fontSize: 13, color: C.muted }}>选择左侧文件查看</div>
                  ) : !selFile.is_text ? (
                    <div style={{ fontSize: 13, color: C.muted }}>二进制文件，不可预览（{(selFile.size / 1024).toFixed(1)} KB）</div>
                  ) : isMd(selFile.path) && mdMode === "pretty" ? (
                    <div className="femd" dangerouslySetInnerHTML={{ __html: mdHtml }} />
                  ) : (
                    <pre style={{ margin: 0, color: C.body, fontFamily: FMONO, fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{selFile.text || "（空文件）"}</pre>
                  )}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            {/* 审核与文档同屏：当前所看版本 pending 就地通过/驳回 */}
            {selVer?.review_status === "pending" && (
              <>
                <Button style={btnPrimary} onClick={() => selVer && review(selVer.id, "approve")}><Check className="size-4 mr-1" />通过发布</Button>
                <Button variant="outline" style={btnGhost} onClick={() => selVer && review(selVer.id, "reject")}><X className="size-4 mr-1" />驳回</Button>
              </>
            )}
            {/* 下架只对已发布（有 current_version）的 skill 开放——没发布过谈不上下架 */}
            {detail?.skill.current_version_id != null && detail.skill.status !== "deprecated" && (
              <Button style={btnDanger} onClick={() => detail && deprecate(detail.skill.id)}>
                <Trash2 className="size-4 mr-1" />下架
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
