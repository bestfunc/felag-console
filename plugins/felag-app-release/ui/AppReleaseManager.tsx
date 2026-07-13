import { useState, useCallback, useEffect } from "react";
import { Button, Input, Label, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Badge, toast,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@platform/ui";
import { Upload, RefreshCw, Trash2, Check } from "lucide-react";

const SLUG = "felag-app-release";

// ── Ice Blue Enterprise 品牌值（bestfunc-design skill §1/§2/§5）；平台 Tailwind 不认插件新 token → 走内联 style ──
const C = {
  signal: "#0A84FF", ink: "#071225", body: "#334155", muted: "#64748B",
  line: "#D8E2F0", surface: "#FFFFFF", surface2: "#F1F6FD", blueTint: "#EAF4FF",
  ok: "#1D9E75", ng: "#F43F5E",
  signalTint: "rgba(10,132,255,.08)", okTint: "rgba(29,158,117,.08)", ngTint: "rgba(244,63,94,.08)",
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
  fontFamily: FMONO, fontSize: 12, letterSpacing: ".16em", textTransform: "uppercase", color: C.signal, marginBottom: mb,
});
const labelStyle: React.CSSProperties = { ...eyebrow(8), display: "block" };
const pill = (color: string, bg: string): React.CSSProperties => ({
  color, background: bg, border: `1px solid ${color}55`, fontFamily: FMONO, fontSize: 12, letterSpacing: ".08em", borderRadius: 999,
});
const btnPrimary: React.CSSProperties = { background: C.signal, color: "#fff", borderRadius: 999, fontFamily: FZH, fontWeight: 800, boxShadow: SHADOW_CARD, border: "none" };
const btnGhost: React.CSSProperties = { background: C.surface, border: `1px solid ${C.line}`, color: C.ink, borderRadius: 999, fontFamily: FZH, fontWeight: 700 };
const btnDanger: React.CSSProperties = { background: C.ng, color: "#fff", borderRadius: 999, fontFamily: FZH, fontWeight: 700, border: "none" };
const cardStyle: React.CSSProperties = { background: "rgba(255,255,255,.92)", border: `1px solid ${C.line}`, borderRadius: 22, boxShadow: SHADOW_CARD, overflow: "hidden" };
const thStyle: React.CSSProperties = { fontFamily: FMONO, fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase", color: C.muted };
const inputStyle: React.CSSProperties = { border: `1px solid ${C.line}`, borderRadius: 14, color: C.ink };
const dialogStyle: React.CSSProperties = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 24, boxShadow: SHADOW_FEATURED, fontFamily: FZH, width: "94vw", maxWidth: 560, maxHeight: "88vh", overflowY: "auto" };

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

// 读文件为 base64（分块 btoa,避免大文件撑爆调用栈）。
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.onload = () => {
      const bytes = new Uint8Array(reader.result as ArrayBuffer);
      let bin = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
      }
      resolve(btoa(bin));
    };
    reader.readAsArrayBuffer(file);
  });
}

type Release = {
  id: number; version: string; platform: string; notes: string; filename: string;
  sha256: string; size: number; uploaded_by: string; created_at?: string; is_current: boolean;
};

const PLATFORMS: { key: string; label: string; hint: string; ext: string }[] = [
  { key: "windows", label: "Windows", hint: ".exe（NSIS 安装包）", ext: ".exe" },
  { key: "darwin", label: "macOS", hint: ".dmg（挂载覆盖）", ext: ".dmg" },
];

function fmtSize(n: number): string {
  if (!n) return "—";
  const mb = n / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;
}

// 从安装包文件名提取版本号（构建命名约定 felag-client-setup-v0.0.27.exe / felag-client-v0.0.27.dmg）。
// 优先取 v 前缀后的点分数字；退而取任意 x.y.z。识别不到返回 ""（回落手填）。
function extractVersion(name: string): string {
  const m = name.match(/[-_]v(\d+(?:\.\d+){1,3})/i) || name.match(/(\d+\.\d+\.\d+(?:\.\d+)?)/);
  return m ? m[1] : "";
}

export default function AppReleaseManager() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [form, setForm] = useState({ version: "", platform: "windows", notes: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await callNode<{ releases: Release[] }>("release_list", {});
      setReleases(r.releases);
    } catch (e: any) { toast.error(e.message); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  function openUpload() {
    setForm({ version: "", platform: "windows", notes: "" });
    setFile(null); setVerAuto(false); setUploadOpen(true);
  }

  const [verAuto, setVerAuto] = useState(false);

  // 选文件时按扩展名自动判平台（.exe→windows / .dmg→darwin）+ 从文件名探测版本号，均仍可手动改
  function onPickFile(f: File | null) {
    setFile(f);
    if (!f) { setVerAuto(false); return; }
    const low = f.name.toLowerCase();
    const platform = low.endsWith(".dmg") ? "darwin" : low.endsWith(".exe") ? "windows" : undefined;
    const ver = extractVersion(f.name);
    setVerAuto(!!ver);
    setForm((s) => ({ ...s, platform: platform ?? s.platform, version: ver || s.version }));
  }

  async function doUpload() {
    const version = form.version.trim();
    if (!version) { toast.error("请填版本号"); return; }
    if (!file) { toast.error("请选择安装包文件"); return; }
    setBusy(true);
    try {
      const content_b64 = await fileToBase64(file);
      await callNode("release_upload", { version, platform: form.platform, notes: form.notes.trim(), content_b64 });
      toast.success("已上传（未发布）"); setUploadOpen(false); refresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function publish(r: Release) {
    try {
      await callNode("release_publish", { release_id: r.id });
      toast.success(`已发布 ${r.platform} v${r.version} 为当前在线版`);
      refresh();
    } catch (e: any) { toast.error(e.message); }
  }

  async function remove(r: Release) {
    try {
      await callNode("release_delete", { release_id: r.id });
      toast.success("已删除");
      refresh();
    } catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="px-8 py-6 space-y-5" style={{ background: AURORA, minHeight: "100%", fontFamily: FZH }}>
      <div className="flex items-end justify-between">
        <div>
          <div style={eyebrow(4)}>CLIENT RELEASE MANAGEMENT</div>
          <h1 style={{ fontFamily: FZH, fontWeight: 800, fontSize: 26, color: C.ink, letterSpacing: "-0.02em" }}>客户端版本管理</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" style={btnGhost} onClick={refresh}><RefreshCw className="size-4 mr-1" />刷新</Button>
          <Button style={btnPrimary} onClick={openUpload}><Upload className="size-4 mr-1" />上传安装包</Button>
        </div>
      </div>

      {PLATFORMS.map((pf) => {
        const list = releases.filter((r) => r.platform === pf.key);
        const current = list.find((r) => r.is_current);
        return (
          <div key={pf.key} className="space-y-2">
            <div className="flex items-center gap-3">
              <h2 style={{ fontFamily: FZH, fontWeight: 700, fontSize: 18, color: C.ink }}>{pf.label}</h2>
              {current
                ? <Badge style={pill(C.ok, C.okTint)}>当前在线 v{current.version}</Badge>
                : <Badge style={pill(C.muted, C.surface2)}>暂无在线版</Badge>}
              <span style={{ fontFamily: FMONO, fontSize: 12, color: C.muted }}>{pf.hint}</span>
            </div>
            <div style={cardStyle}>
              <Table>
                <TableHeader>
                  <TableRow style={{ background: C.surface2 }}>
                    <TableHead style={thStyle}>版本</TableHead>
                    <TableHead style={thStyle}>说明</TableHead>
                    <TableHead style={thStyle}>大小</TableHead>
                    <TableHead style={thStyle}>上传时间</TableHead>
                    <TableHead style={thStyle}>状态</TableHead>
                    <TableHead style={thStyle}></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell style={{ fontFamily: FMONO, fontSize: 13, color: C.ink, fontWeight: 600 }}>v{r.version}</TableCell>
                      <TableCell style={{ color: C.body, maxWidth: 280 }}>{r.notes || <span style={{ color: C.muted }}>—</span>}</TableCell>
                      <TableCell style={{ fontFamily: FMONO, fontSize: 13, color: C.body }}>{fmtSize(r.size)}</TableCell>
                      <TableCell style={{ fontFamily: FMONO, fontSize: 12, color: C.muted }}>{(r.created_at || "").replace("T", " ").slice(0, 16)}</TableCell>
                      <TableCell>
                        {r.is_current
                          ? <Badge style={pill(C.ok, C.okTint)}>当前在线</Badge>
                          : <Badge style={pill(C.muted, C.surface2)}>已上传</Badge>}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2 justify-end">
                          {!r.is_current && (
                            <Button size="sm" style={{ ...btnPrimary, boxShadow: "none" }} onClick={() => publish(r)}>
                              <Check className="size-4 mr-1" />发布
                            </Button>
                          )}
                          {r.is_current && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: C.ok, fontFamily: FMONO, fontSize: 12 }}>
                              <Check className="size-4" />在线中
                            </span>
                          )}
                          <Button variant="outline" size="sm" style={r.is_current ? { ...btnGhost, opacity: 0.5 } : btnDanger}
                            disabled={r.is_current} onClick={() => remove(r)}>
                            <Trash2 className="size-4 mr-1" />删除
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {list.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <div style={{ fontFamily: FMONO, fontSize: 13, color: C.muted, padding: "28px 0", textAlign: "center" }}>暂无 {pf.label} 版本</div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        );
      })}

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent style={dialogStyle}>
          <DialogHeader>
            <div style={eyebrow(6)}>UPLOAD · 上传</div>
            <DialogTitle style={{ fontFamily: FZH, fontWeight: 700, color: C.ink }}>上传客户端安装包</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label style={labelStyle}>安装包文件</Label>
              <input type="file" accept=".exe,.dmg" onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                style={{ fontFamily: FMONO, fontSize: 13, color: C.body }} />
              {file && <div style={{ marginTop: 6, fontFamily: FMONO, fontSize: 12, color: C.signal }}>{file.name} · {fmtSize(file.size)}</div>}
            </div>
            <div>
              <Label style={labelStyle}>平台</Label>
              <Select value={form.platform} onValueChange={(v) => setForm({ ...form, platform: v })}>
                <SelectTrigger style={inputStyle}><SelectValue /></SelectTrigger>
                <SelectContent>{PLATFORMS.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label style={labelStyle}>版本号</Label>
              <Input style={inputStyle} value={form.version}
                onChange={(e) => { setVerAuto(false); setForm({ ...form, version: e.target.value }); }}
                placeholder="选择文件后自动识别，如 0.0.27" />
              <div style={{ marginTop: 6, fontFamily: FMONO, fontSize: 12, color: verAuto ? C.ok : C.muted }}>
                {verAuto ? "已从文件名识别，可修改" : "从文件名自动识别（如未识别请手填）"}
              </div>
            </div>
            <div>
              <Label style={labelStyle}>更新说明</Label>
              <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="本次更新内容（可空）"
                style={{ ...inputStyle, width: "100%", padding: "8px 12px", fontFamily: FZH, fontSize: 14, resize: "vertical" }} />
            </div>
          </div>
          <DialogFooter>
            <Button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={doUpload}>
              <Upload className="size-4 mr-1" />{busy ? "上传中…" : "上传（暂不发布）"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
