import { useState, useCallback, useEffect } from "react";
import { Button, Input, Label, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
  Badge, toast, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  useCurrentLanguage } from "@platform/ui";
// ⚠️ 只用已在本平台真机验证过的图标 —— 平台 plugin-sdk 只 re-export lucide 的一个子集,
// 白名单外的名字运行时是 undefined,渲染直接 React error #130(Rocket/Boxes/Link2 都不在)。
import { RefreshCw, Trash2, Plus } from "lucide-react";

const SLUG = "felag-console-model";

// ── i18n:单文件 tsx 插件自带轻量语言包;useCurrentLanguage() 随平台切换响应式返回 'zh'|'en'。
//    模块级函数(callNode)拿不到 hook,故把 t 作参数传入。 ──
const I18N = {
  zh: {
    reqFail: "请求失败",
    title: "模型与密钥", refresh: "刷新", addBtn: "新增模型", connBtn: "连接配置",
    eyebrow: "MODELS · 模型与密钥",
    lead: "数字员工可用的 LLM 模型在这里维护。上游密钥只经 felag-server 透传给网关保存，" +
      "不落本平台数据库、也不会回显——列表只显示“已配置 / 未配置”。",
    notConfigured: "尚未连接 felag-server",
    notConfiguredSub: "先填写 felag-server 地址与共享服务令牌，才能读写网关上的模型。",
    thModel: "模型名", thUpstream: "上游", thBase: "上游地址", thKey: "密钥", thSource: "来源", thOps: "操作",
    keyOk: "已配置", keyNo: "未配置", keyRef: (r: string) => `环境变量 ${r}`,
    srcDb: "本页面注册", srcYaml: "配置文件",
    yamlHint: "配置文件里定义的模型只能在网关配置文件里改，本页面不可删",
    empty: "网关上还没有模型",
    emptySub: "点「新增模型」把上游模型注册进来，数字员工即可选用。",
    delete: "删除", del1: "确定删除模型", del2: "？删除后数字员工将无法再选用它。",
    deleted: "已删除", saved: "已保存",
    dlgAddTitle: "新增 / 更新模型", dlgAddEyebrow: "MODEL · 模型",
    fldName: "模型名", fldNameHint: "客户端发起请求时使用的名字，如 deepseek-v4-pro",
    fldUpstream: "上游模型", fldUpstreamHint: "网关的 model 值，形如 deepseek/deepseek-v4-pro、openai/glm-4.6v-flash",
    fldKey: "上游密钥", fldKeyHint: "留空 = 不改动已有密钥。可填真实密钥，或 os.environ/XXX 引用网关侧环境变量",
    fldKeyPh: "留空则保持不变",
    fldBase: "上游地址", fldBaseHint: "仅兼容 / 自建端点需要填",
    keyWarn: "密钥提交后由网关保存，本页面此后只能看到“已配置”，无法再读出。",
    dlgConnTitle: "连接配置", dlgConnEyebrow: "CONNECTION · 连接",
    fldBaseUrl: "felag-server 地址", fldBaseUrlHint: "如 http://felag-server:28080",
    fldToken: "共享服务令牌", fldTokenHint: "需与 felag-server 的 FELAG_MODEL_ADMIN_TOKEN 同值",
    tokenSet: "已配置（留空则保持不变）", tokenUnset: "未配置",
    save: "保存", cancel: "取消", submit: "提交", saving: "保存中…",
    needName: "请填模型名", needUpstream: "请填上游模型",
  },
  en: {
    reqFail: "Request failed",
    title: "Models & Keys", refresh: "Refresh", addBtn: "Add model", connBtn: "Connection",
    eyebrow: "MODELS · KEYS",
    lead: "Maintain the LLM models available to digital employees. Upstream keys are passed through " +
      "felag-server to the gateway and stored there — never in this platform's database, and never read back.",
    notConfigured: "Not connected to felag-server",
    notConfiguredSub: "Set the felag-server address and shared service token before managing models.",
    thModel: "Model", thUpstream: "Upstream", thBase: "API base", thKey: "Key", thSource: "Source", thOps: "Actions",
    keyOk: "Configured", keyNo: "Not set", keyRef: (r: string) => `env ${r}`,
    srcDb: "Added here", srcYaml: "Config file",
    yamlHint: "Models defined in the gateway config file can only be changed there",
    empty: "No models on the gateway yet",
    emptySub: "Use “Add model” to register an upstream model.",
    delete: "Delete", del1: "Delete model", del2: "? Digital employees will no longer be able to use it.",
    deleted: "Deleted", saved: "Saved",
    dlgAddTitle: "Add / update model", dlgAddEyebrow: "MODEL",
    fldName: "Model name", fldNameHint: "The name clients call, e.g. deepseek-v4-pro",
    fldUpstream: "Upstream model", fldUpstreamHint: "Gateway model value, e.g. deepseek/deepseek-v4-pro",
    fldKey: "Upstream key", fldKeyHint: "Leave blank to keep the existing key. Accepts a real key or os.environ/XXX",
    fldKeyPh: "Leave blank to keep unchanged",
    fldBase: "API base", fldBaseHint: "Only needed for compatible / self-hosted endpoints",
    keyWarn: "Once submitted the key is stored by the gateway; this page can only show whether it is set.",
    dlgConnTitle: "Connection", dlgConnEyebrow: "CONNECTION",
    fldBaseUrl: "felag-server address", fldBaseUrlHint: "e.g. http://felag-server:28080",
    fldToken: "Shared service token", fldTokenHint: "Must match FELAG_MODEL_ADMIN_TOKEN on felag-server",
    tokenSet: "Configured (leave blank to keep)", tokenUnset: "Not set",
    save: "Save", cancel: "Cancel", submit: "Submit", saving: "Saving…",
    needName: "Model name is required", needUpstream: "Upstream model is required",
  },
};
type Dict = typeof I18N.zh;

// ── Ice Blue Enterprise 品牌值(bestfunc-design skill §1/§2/§5);平台 Tailwind 不认插件新 token → 走内联 style ──
const C = {
  signal: "#0A84FF", ink: "#071225", body: "#334155", muted: "#64748B",
  line: "#D8E2F0", surface: "#FFFFFF", surface2: "#F1F6FD", blueTint: "#EAF4FF",
  ok: "#1D9E75", ng: "#F43F5E", warn: "#B45309",
  okTint: "rgba(29,158,117,.08)", ngTint: "rgba(244,63,94,.08)", warnTint: "#FEF3C7",
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
const cardStyle: React.CSSProperties = { background: "rgba(255,255,255,.92)", border: `1px solid ${C.line}`, borderRadius: 22, boxShadow: SHADOW_CARD, overflow: "hidden" };
const thStyle: React.CSSProperties = { fontFamily: FMONO, fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase", color: C.muted };
const inputStyle: React.CSSProperties = { border: `1px solid ${C.line}`, borderRadius: 14, color: C.ink };
const hintStyle: React.CSSProperties = { fontSize: 12, color: C.muted, marginTop: 6, lineHeight: 1.6 };
const dialogStyle: React.CSSProperties = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 24, boxShadow: SHADOW_FEATURED, fontFamily: FZH, width: "94vw", maxWidth: 560, maxHeight: "88vh", overflowY: "auto" };

interface ModelRow {
  id?: string; modelName: string; upstream?: string; provider?: string;
  apiBase?: string; keyConfigured: boolean; keyRef?: string; dbManaged: boolean;
}
interface ListResp {
  models: ModelRow[];
  config: { felag_server_base?: string; felag_model_admin_token?: boolean };
  configured: boolean;
  hint?: string;
}

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

export default function ModelManager() {
  const lang = useCurrentLanguage();
  const t = (I18N as any)[lang === "en" ? "en" : "zh"] as Dict;

  const [data, setData] = useState<ListResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [connOpen, setConnOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // 新增/更新模型表单
  const [mName, setMName] = useState("");
  const [mUpstream, setMUpstream] = useState("");
  const [mKey, setMKey] = useState("");
  const [mBase, setMBase] = useState("");
  // 连接配置表单
  const [cBase, setCBase] = useState("");
  const [cToken, setCToken] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await callNode<ListResp>("model_list", {}, t);
      setData(r);
      setCBase(r?.config?.felag_server_base || "");
    } catch (e: any) {
      toast.error(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  function openAdd(row?: ModelRow) {
    setMName(row?.modelName || "");
    setMUpstream(row?.upstream || "");
    setMBase(row?.apiBase || "");
    setMKey(""); // 永远空:已有 key 读不回来,留空即"不改动"
    setAddOpen(true);
  }

  async function submitModel() {
    if (!mName.trim()) { toast.error(t.needName); return; }
    if (!mUpstream.trim()) { toast.error(t.needUpstream); return; }
    setBusy(true);
    try {
      await callNode("model_upsert", {
        model_name: mName.trim(), upstream: mUpstream.trim(),
        api_key: mKey.trim(), api_base: mBase.trim(),
      }, t);
      toast.success(t.saved);
      setAddOpen(false);
      setMKey("");
      await load();
    } catch (e: any) {
      toast.error(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function removeModel(row: ModelRow) {
    if (!row.id) return;
    if (!window.confirm(`${t.del1} ${row.modelName}${t.del2}`)) return;
    setBusy(true);
    try {
      await callNode("model_delete", { model_id: row.id, model_name: row.modelName }, t);
      toast.success(t.deleted);
      await load();
    } catch (e: any) {
      toast.error(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function saveConn() {
    setBusy(true);
    try {
      const cfg: Record<string, string> = {};
      if (cBase.trim()) cfg.felag_server_base = cBase.trim();
      if (cToken.trim()) cfg.felag_model_admin_token = cToken.trim();
      await callNode("model_set_config", { config: cfg }, t);
      toast.success(t.saved);
      setConnOpen(false);
      setCToken("");
      await load();
    } catch (e: any) {
      toast.error(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  const models = data?.models || [];

  return (
    <div style={{ background: AURORA, minHeight: "100%", padding: "28px 32px 48px", fontFamily: FZH }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 22 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={eyebrow(6)}>{t.eyebrow}</div>
          <h2 style={{ fontSize: 26, fontWeight: 900, color: C.ink, letterSpacing: "-.03em", margin: 0 }}>{t.title}</h2>
          <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.7, margin: "10px 0 0", maxWidth: 760 }}>{t.lead}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <Button style={btnGhost} onClick={load} disabled={loading}>
            <RefreshCw size={15} style={{ marginRight: 6 }} />{t.refresh}
          </Button>
          <Button style={btnGhost} onClick={() => setConnOpen(true)}>
            {t.connBtn}
          </Button>
          <Button style={btnPrimary} onClick={() => openAdd()} disabled={!data?.configured}>
            <Plus size={15} style={{ marginRight: 6 }} />{t.addBtn}
          </Button>
        </div>
      </div>

      {data && !data.configured ? (
        <div style={{ ...cardStyle, padding: "44px 28px", textAlign: "center" }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.ink, marginBottom: 8 }}>{t.notConfigured}</div>
          <div style={{ fontSize: 13.5, color: C.muted, marginBottom: 20 }}>{t.notConfiguredSub}</div>
          <Button style={btnPrimary} onClick={() => setConnOpen(true)}>
            {t.connBtn}
          </Button>
        </div>
      ) : models.length === 0 ? (
        <div style={{ ...cardStyle, padding: "44px 28px", textAlign: "center" }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.ink, marginBottom: 8 }}>{t.empty}</div>
          <div style={{ fontSize: 13.5, color: C.muted }}>{t.emptySub}</div>
        </div>
      ) : (
        <div style={cardStyle}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead style={thStyle}>{t.thModel}</TableHead>
                <TableHead style={thStyle}>{t.thUpstream}</TableHead>
                <TableHead style={thStyle}>{t.thBase}</TableHead>
                <TableHead style={thStyle}>{t.thKey}</TableHead>
                <TableHead style={thStyle}>{t.thSource}</TableHead>
                <TableHead style={{ ...thStyle, textAlign: "right" }}>{t.thOps}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.map((m) => (
                <TableRow key={m.id || m.modelName}>
                  <TableCell style={{ fontWeight: 700, color: C.ink }}>{m.modelName}</TableCell>
                  <TableCell style={{ fontFamily: FMONO, fontSize: 12.5, color: C.body }}>{m.upstream || "—"}</TableCell>
                  <TableCell style={{ fontFamily: FMONO, fontSize: 12, color: C.muted, wordBreak: "break-all" }}>{m.apiBase || "—"}</TableCell>
                  <TableCell>
                    {m.keyConfigured
                      ? <Badge style={pill(C.ok, C.okTint)}>{m.keyRef ? t.keyRef(m.keyRef) : t.keyOk}</Badge>
                      : <Badge style={pill(C.warn, C.warnTint)}>{t.keyNo}</Badge>}
                  </TableCell>
                  <TableCell>
                    <Badge style={pill(m.dbManaged ? C.signal : C.muted, m.dbManaged ? C.blueTint : C.surface2)}>
                      {m.dbManaged ? t.srcDb : t.srcYaml}
                    </Badge>
                  </TableCell>
                  <TableCell style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {m.dbManaged ? (
                      <>
                        <Button style={{ ...btnGhost, marginRight: 8 }} size="sm" onClick={() => openAdd(m)} disabled={busy}>
                          {t.save}
                        </Button>
                        <Button style={{ ...btnGhost, color: C.ng, borderColor: `${C.ng}55` }} size="sm"
                                onClick={() => removeModel(m)} disabled={busy}>
                          <Trash2 size={14} style={{ marginRight: 4 }} />{t.delete}
                        </Button>
                      </>
                    ) : (
                      <span style={{ fontSize: 12, color: C.muted }}>{t.yamlHint}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent style={dialogStyle}>
          <DialogHeader>
            <div style={eyebrow(4)}>{t.dlgAddEyebrow}</div>
            <DialogTitle style={{ fontSize: 20, fontWeight: 800, color: C.ink }}>{t.dlgAddTitle}</DialogTitle>
          </DialogHeader>
          <div style={{ display: "grid", gap: 18, padding: "6px 0 2px" }}>
            <div>
              <Label style={labelStyle}>{t.fldName}</Label>
              <Input style={inputStyle} value={mName} onChange={(e) => setMName(e.target.value)} placeholder="deepseek-v4-pro" />
              <div style={hintStyle}>{t.fldNameHint}</div>
            </div>
            <div>
              <Label style={labelStyle}>{t.fldUpstream}</Label>
              <Input style={inputStyle} value={mUpstream} onChange={(e) => setMUpstream(e.target.value)} placeholder="deepseek/deepseek-v4-pro" />
              <div style={hintStyle}>{t.fldUpstreamHint}</div>
            </div>
            <div>
              <Label style={labelStyle}>{t.fldKey}</Label>
              <Input style={inputStyle} type="password" autoComplete="new-password" value={mKey}
                     onChange={(e) => setMKey(e.target.value)} placeholder={t.fldKeyPh} />
              <div style={hintStyle}>{t.fldKeyHint}</div>
              <div style={{ ...hintStyle, color: C.warn }}>{t.keyWarn}</div>
            </div>
            <div>
              <Label style={labelStyle}>{t.fldBase}</Label>
              <Input style={inputStyle} value={mBase} onChange={(e) => setMBase(e.target.value)} placeholder="https://open.bigmodel.cn/api/paas/v4" />
              <div style={hintStyle}>{t.fldBaseHint}</div>
            </div>
          </div>
          <DialogFooter>
            <Button style={btnGhost} onClick={() => setAddOpen(false)} disabled={busy}>{t.cancel}</Button>
            <Button style={btnPrimary} onClick={submitModel} disabled={busy}>{busy ? t.saving : t.submit}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={connOpen} onOpenChange={setConnOpen}>
        <DialogContent style={dialogStyle}>
          <DialogHeader>
            <div style={eyebrow(4)}>{t.dlgConnEyebrow}</div>
            <DialogTitle style={{ fontSize: 20, fontWeight: 800, color: C.ink }}>{t.dlgConnTitle}</DialogTitle>
          </DialogHeader>
          <div style={{ display: "grid", gap: 18, padding: "6px 0 2px" }}>
            <div>
              <Label style={labelStyle}>{t.fldBaseUrl}</Label>
              <Input style={inputStyle} value={cBase} onChange={(e) => setCBase(e.target.value)} placeholder="http://felag-server:28080" />
              <div style={hintStyle}>{t.fldBaseUrlHint}</div>
            </div>
            <div>
              <Label style={labelStyle}>{t.fldToken}</Label>
              <Input style={inputStyle} type="password" autoComplete="new-password" value={cToken}
                     onChange={(e) => setCToken(e.target.value)}
                     placeholder={data?.config?.felag_model_admin_token ? t.tokenSet : t.tokenUnset} />
              <div style={hintStyle}>{t.fldTokenHint}</div>
            </div>
          </div>
          <DialogFooter>
            <Button style={btnGhost} onClick={() => setConnOpen(false)} disabled={busy}>{t.cancel}</Button>
            <Button style={btnPrimary} onClick={saveConn} disabled={busy}>{busy ? t.saving : t.save}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
