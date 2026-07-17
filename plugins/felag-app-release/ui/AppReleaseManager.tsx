import { useState, useCallback, useEffect } from "react";
import { Button, Input, Label, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Badge, toast,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, useCurrentLanguage } from "@platform/ui";
import { Upload, RefreshCw, Trash2, Check } from "lucide-react";

const SLUG = "felag-app-release";

// ── i18n(PD_001_30):单文件 tsx 插件自带轻量语言包;useCurrentLanguage() 随平台切换响应式返回 'zh'|'en'。
//    模块级函数(callNode/uploadNode/fileToBase64)拿不到 hook,故把 t 作参数传入。 ──
const I18N = {
  zh: {
    reqFail: "请求失败", respParseFail: "响应解析失败",
    reqFailHttp: (s: number) => `请求失败(HTTP ${s})`,
    netFail: "网络错误,上传失败", readFileFail: "读取文件失败",
    needVersion: "请填版本号", needFile: "请选择安装包文件",
    uploaded: "已上传（未发布）",
    published: (pf: string, v: string) => `已发布 ${pf} v${v} 为当前在线版`,
    deleted: "已删除",
    title: "客户端版本管理", refresh: "刷新", uploadBtn: "上传安装包",
    currentOnlineV: (v: string) => `当前在线 v${v}`, noOnline: "暂无在线版",
    hintExe: ".exe（NSIS 安装包）", hintDmg: ".dmg（挂载覆盖）",
    thVersion: "版本", thNotes: "说明", thSize: "大小", thUploadTime: "上传时间", thStatus: "状态",
    currentOnline: "当前在线", uploadedStatus: "已上传", online: "在线中",
    publish: "发布", delete: "删除",
    noVersionFor: (label: string) => `暂无 ${label} 版本`,
    dlgEyebrow: "UPLOAD · 上传", dlgTitle: "上传客户端安装包",
    fldFile: "安装包文件", fldPlatform: "平台", fldVersion: "版本号",
    verPlaceholder: "选择文件后自动识别，如 0.0.27",
    verAutoOk: "已从文件名识别，可修改",
    verAutoHint: "从文件名自动识别（如未识别请手填）",
    fldNotes: "更新说明", notesPlaceholder: "本次更新内容（可空）",
    reading: "读取文件…",
    uploadingBig: (p: number | string) => `上传中 ${p}%（大包约 90MB,请勿关闭）`,
    readingShort: "读取中…",
    uploadingShort: (p: number | string) => `上传中 ${p}%`,
    uploadNoPublish: "上传（暂不发布）",
  },
  en: {
    reqFail: "Request failed", respParseFail: "Failed to parse response",
    reqFailHttp: (s: number) => `Request failed (HTTP ${s})`,
    netFail: "Network error, upload failed", readFileFail: "Failed to read file",
    needVersion: "Please enter a version", needFile: "Please choose an installer file",
    uploaded: "Uploaded (not published)",
    published: (pf: string, v: string) => `Published ${pf} v${v} as the live version`,
    deleted: "Deleted",
    title: "Client Release Management", refresh: "Refresh", uploadBtn: "Upload installer",
    currentOnlineV: (v: string) => `Live v${v}`, noOnline: "No live version",
    hintExe: ".exe (NSIS installer)", hintDmg: ".dmg (mount & replace)",
    thVersion: "Version", thNotes: "Notes", thSize: "Size", thUploadTime: "Uploaded at", thStatus: "Status",
    currentOnline: "Live", uploadedStatus: "Uploaded", online: "Online",
    publish: "Publish", delete: "Delete",
    noVersionFor: (label: string) => `No ${label} versions`,
    dlgEyebrow: "UPLOAD", dlgTitle: "Upload client installer",
    fldFile: "Installer file", fldPlatform: "Platform", fldVersion: "Version",
    verPlaceholder: "Auto-detected after picking a file, e.g. 0.0.27",
    verAutoOk: "Detected from filename, editable",
    verAutoHint: "Auto-detected from filename (enter manually if not detected)",
    fldNotes: "Release notes", notesPlaceholder: "What's in this update (optional)",
    reading: "Reading file…",
    uploadingBig: (p: number | string) => `Uploading ${p}% (~90MB, please keep open)`,
    readingShort: "Reading…",
    uploadingShort: (p: number | string) => `Uploading ${p}%`,
    uploadNoPublish: "Upload (don't publish yet)",
  },
};
type Dict = typeof I18N.zh;

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

// uploadNode 走 XHR 上传节点,带上传进度回调(fetch 不支持 upload progress)。
// 大包(~90MB base64 后 ~120MB)需要真实进度条,故上传路径单走 XHR。env 解析与 callNode 对齐。
function uploadNode<T>(node: string, params: object, onProgress: (pct: number) => void, t: Dict): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/dag/${SLUG}/${node}`);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let env: any;
      try { env = JSON.parse(xhr.responseText); } catch { reject(new Error(t.respParseFail)); return; }
      const first = env?.data?.results?.[0];
      if (env?.code !== 0 || first?.error) {
        const raw = first?.error || env?.message || t.reqFailHttp(xhr.status);
        const m = String(raw).match(/(?:ValueError|RuntimeError|NodeError|TypeError):\s*([^\n]+)/);
        reject(new Error(m ? m[1].trim() : String(raw)));
      } else {
        resolve(first?.output?.result as T);
      }
    };
    xhr.onerror = () => reject(new Error(t.netFail));
    xhr.send(JSON.stringify(params));
  });
}

// 读文件为 base64（分块 btoa,避免大文件撑爆调用栈）。
function fileToBase64(file: File, t: Dict): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t.readFileFail));
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

// label 是品牌名(Windows/macOS)不译;hint 文案按语言从 t 取(见渲染处 hintExe/hintDmg)。
const PLATFORMS: { key: string; label: string; ext: string }[] = [
  { key: "windows", label: "Windows", ext: ".exe" },
  { key: "darwin", label: "macOS", ext: ".dmg" },
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
  const t = I18N[useCurrentLanguage()];
  const [releases, setReleases] = useState<Release[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [form, setForm] = useState({ version: "", platform: "windows", notes: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  // upload 进度:"reading"=读盘/base64 阶段(不确定进度) | 0-100=上传百分比 | null=空闲
  const [progress, setProgress] = useState<"reading" | number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await callNode<{ releases: Release[] }>("release_list", {}, t);
      setReleases(r.releases);
    } catch (e: any) { toast.error(e.message); }
  }, [t]);

  useEffect(() => { refresh(); }, [refresh]);

  function openUpload() {
    setForm({ version: "", platform: "windows", notes: "" });
    setFile(null); setVerAuto(false); setProgress(null); setUploadOpen(true);
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
    if (!version) { toast.error(t.needVersion); return; }
    if (!file) { toast.error(t.needFile); return; }
    setBusy(true);
    setProgress("reading");
    try {
      const content_b64 = await fileToBase64(file, t);
      setProgress(0);
      await uploadNode("release_upload", { version, platform: form.platform, notes: form.notes.trim(), content_b64 }, setProgress, t);
      toast.success(t.uploaded); setUploadOpen(false); refresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); setProgress(null); }
  }

  async function publish(r: Release) {
    try {
      await callNode("release_publish", { release_id: r.id }, t);
      toast.success(t.published(r.platform, r.version));
      refresh();
    } catch (e: any) { toast.error(e.message); }
  }

  async function remove(r: Release) {
    try {
      await callNode("release_delete", { release_id: r.id }, t);
      toast.success(t.deleted);
      refresh();
    } catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="px-8 py-6 space-y-5" style={{ background: AURORA, minHeight: "100%", fontFamily: FZH }}>
      <div className="flex items-end justify-between">
        <div>
          <div style={eyebrow(4)}>CLIENT RELEASE MANAGEMENT</div>
          <h1 style={{ fontFamily: FZH, fontWeight: 800, fontSize: 26, color: C.ink, letterSpacing: "-0.02em" }}>{t.title}</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" style={btnGhost} onClick={refresh}><RefreshCw className="size-4 mr-1" />{t.refresh}</Button>
          <Button style={btnPrimary} onClick={openUpload}><Upload className="size-4 mr-1" />{t.uploadBtn}</Button>
        </div>
      </div>

      {PLATFORMS.map((pf) => {
        const list = releases.filter((r) => r.platform === pf.key);
        const current = list.find((r) => r.is_current);
        const hint = pf.key === "windows" ? t.hintExe : t.hintDmg;
        return (
          <div key={pf.key} className="space-y-2">
            <div className="flex items-center gap-3">
              <h2 style={{ fontFamily: FZH, fontWeight: 700, fontSize: 18, color: C.ink }}>{pf.label}</h2>
              {current
                ? <Badge style={pill(C.ok, C.okTint)}>{t.currentOnlineV(current.version)}</Badge>
                : <Badge style={pill(C.muted, C.surface2)}>{t.noOnline}</Badge>}
              <span style={{ fontFamily: FMONO, fontSize: 12, color: C.muted }}>{hint}</span>
            </div>
            <div style={cardStyle}>
              <Table>
                <TableHeader>
                  <TableRow style={{ background: C.surface2 }}>
                    <TableHead style={thStyle}>{t.thVersion}</TableHead>
                    <TableHead style={thStyle}>{t.thNotes}</TableHead>
                    <TableHead style={thStyle}>{t.thSize}</TableHead>
                    <TableHead style={thStyle}>{t.thUploadTime}</TableHead>
                    <TableHead style={thStyle}>{t.thStatus}</TableHead>
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
                          ? <Badge style={pill(C.ok, C.okTint)}>{t.currentOnline}</Badge>
                          : <Badge style={pill(C.muted, C.surface2)}>{t.uploadedStatus}</Badge>}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2 justify-end">
                          {!r.is_current && (
                            <Button size="sm" style={{ ...btnPrimary, boxShadow: "none" }} onClick={() => publish(r)}>
                              <Check className="size-4 mr-1" />{t.publish}
                            </Button>
                          )}
                          {r.is_current && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: C.ok, fontFamily: FMONO, fontSize: 12 }}>
                              <Check className="size-4" />{t.online}
                            </span>
                          )}
                          <Button variant="outline" size="sm" style={r.is_current ? { ...btnGhost, opacity: 0.5 } : btnDanger}
                            disabled={r.is_current} onClick={() => remove(r)}>
                            <Trash2 className="size-4 mr-1" />{t.delete}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {list.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <div style={{ fontFamily: FMONO, fontSize: 13, color: C.muted, padding: "28px 0", textAlign: "center" }}>{t.noVersionFor(pf.label)}</div>
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
            <div style={eyebrow(6)}>{t.dlgEyebrow}</div>
            <DialogTitle style={{ fontFamily: FZH, fontWeight: 700, color: C.ink }}>{t.dlgTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label style={labelStyle}>{t.fldFile}</Label>
              <input type="file" accept=".exe,.dmg" onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                style={{ fontFamily: FMONO, fontSize: 13, color: C.body }} />
              {file && <div style={{ marginTop: 6, fontFamily: FMONO, fontSize: 12, color: C.signal }}>{file.name} · {fmtSize(file.size)}</div>}
            </div>
            <div>
              <Label style={labelStyle}>{t.fldPlatform}</Label>
              <Select value={form.platform} onValueChange={(v) => setForm({ ...form, platform: v })}>
                <SelectTrigger style={inputStyle}><SelectValue /></SelectTrigger>
                <SelectContent>{PLATFORMS.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label style={labelStyle}>{t.fldVersion}</Label>
              <Input style={inputStyle} value={form.version}
                onChange={(e) => { setVerAuto(false); setForm({ ...form, version: e.target.value }); }}
                placeholder={t.verPlaceholder} />
              <div style={{ marginTop: 6, fontFamily: FMONO, fontSize: 12, color: verAuto ? C.ok : C.muted }}>
                {verAuto ? t.verAutoOk : t.verAutoHint}
              </div>
            </div>
            <div>
              <Label style={labelStyle}>{t.fldNotes}</Label>
              <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={t.notesPlaceholder}
                style={{ ...inputStyle, width: "100%", padding: "8px 12px", fontFamily: FZH, fontSize: 14, resize: "vertical" }} />
            </div>
          </div>
          {busy && (
            <div style={{ marginTop: 10 }}>
              <div style={{ height: 8, background: C.surface2, borderRadius: 999, overflow: "hidden" }}>
                <div style={{
                  height: "100%",
                  width: progress === "reading" ? "40%" : `${progress}%`,
                  background: C.signal, borderRadius: 999,
                  transition: "width .2s ease",
                  opacity: progress === "reading" ? 0.5 : 1,
                }} />
              </div>
              <div style={{ marginTop: 6, fontFamily: FMONO, fontSize: 12, color: C.muted }}>
                {progress === "reading" ? t.reading : t.uploadingBig(progress as number)}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={doUpload}>
              <Upload className="size-4 mr-1" />
              {busy ? (progress === "reading" ? t.readingShort : t.uploadingShort(progress as number)) : t.uploadNoPublish}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
