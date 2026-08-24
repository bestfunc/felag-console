import { useState, useCallback, useEffect, useMemo } from "react";
import { Button, Input, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
  Badge, toast, useCurrentLanguage } from "@platform/ui";
// ⚠️ 只用已在本平台真机验证过的图标 —— 平台 plugin-sdk 只 re-export lucide 的一个子集,
// 白名单外的名字运行时是 undefined,渲染直接 React error #130。
import { RefreshCw, FileText } from "lucide-react";

const SLUG = "felag-token-stats";

// ── i18n:单文件 tsx 插件自带轻量语言包;useCurrentLanguage() 随平台切换响应式返回 'zh'|'en'。
//    模块级函数(callNode)拿不到 hook,故把 t 作参数传入。 ──
const I18N = {
  zh: {
    reqFail: "请求失败",
    title: "Token 用量统计", eyebrow: "USAGE · TOKEN 用量",
    lead: "数字员工经 felag-server 发出的每次 LLM 请求,都由网关记下模型与 token 数;这里按员工、" +
      "部门、模型、日期看消耗,也能逐条查明细。token 数取自网关账本(权威值);成本是按官方单价" +
      "现算的估值,不是账单 —— 口径见成本卡下方说明。",
    refresh: "刷新", export: "导出 CSV", exporting: "导出中…",
    today: "今天", d7: "近 7 天", d30: "近 30 天", to: "至",
    allModels: "全部模型", model: "模型",
    tabAgg: "聚合", tabDetail: "明细",
    byEmployee: "按员工", byDepartment: "按部门", byModel: "按模型", byDay: "按日期",
    cardTotal: "总 token", cardReq: "请求数", cardIn: "输入 token", cardOut: "输出 token", cardSpend: "成本",
    spendHint: "按官方单价 × token 数估算(元)。已区分高峰/空闲时段;但**未扣缓存命中折扣**," +
      "缓存命中价只有未命中的 1/30,故这里是上限,真实账单会更低。",
    unpricedWarn: (ms: string) => `以下模型没配单价,成本按 0 计:${ms}`,
    thPeak: "时段", peak: "高峰", offPeak: "空闲",
    peakTip: "工作日 9:00-12:00、14:00-18:00 为高峰;其余(含周末)单价减半",
    trend: "每日消耗", trendEmpty: "该范围内没有用量",
    thName: "名称", thDept: "部门", thReq: "请求数", thIn: "输入", thOut: "输出", thTotal: "总 token", thSpend: "成本",
    thTime: "时间", thEmployee: "员工", thModel: "模型", thDevice: "设备", thIp: "IP", thReqId: "request_id",
    empty: "该时间范围内没有用量记录",
    emptySub: "换个时间范围试试。若确认有人在用,检查 felag-server 是否已升级到带用量归属的版本。",
    unattributed: "未归属",
    unattributedTip: "该请求发生在用量归属上线之前,网关账本里没有员工信息",
    prev: "上一页", next: "下一页",
    pageInfo: (p: number, n: number, total: number) => `第 ${p}/${n} 页 · 共 ${total} 条`,
    exported: (n: number) => `已导出 ${n} 条`,
    noRows: "没有可导出的记录",
  },
  en: {
    reqFail: "Request failed",
    title: "Token Usage", eyebrow: "USAGE · TOKENS",
    lead: "Every LLM request digital employees send through felag-server is recorded by the gateway with its " +
      "model and token counts. Break it down by employee, department, model or date, or inspect single requests. " +
      "Token counts come from the gateway ledger (authoritative); cost is an estimate computed from official " +
      "list prices — not an invoice. See the note under the cost card.",
    refresh: "Refresh", export: "Export CSV", exporting: "Exporting…",
    today: "Today", d7: "Last 7 days", d30: "Last 30 days", to: "to",
    allModels: "All models", model: "Model",
    tabAgg: "Aggregate", tabDetail: "Requests",
    byEmployee: "By employee", byDepartment: "By department", byModel: "By model", byDay: "By date",
    cardTotal: "Total tokens", cardReq: "Requests", cardIn: "Input tokens", cardOut: "Output tokens", cardSpend: "Cost",
    spendHint: "Estimated as official unit price × tokens (CNY). Peak/off-peak hours are accounted for, " +
      "but cache-hit discounts are NOT — cache hits cost 1/30 of a miss, so this is an upper bound.",
    unpricedWarn: (ms: string) => `No pricing configured for these models, cost counted as 0: ${ms}`,
    thPeak: "Rate", peak: "Peak", offPeak: "Off-peak",
    peakTip: "Weekdays 9:00-12:00 and 14:00-18:00 are peak; everything else (incl. weekends) is half price",
    trend: "Daily usage", trendEmpty: "No usage in this range",
    thName: "Name", thDept: "Department", thReq: "Requests", thIn: "Input", thOut: "Output", thTotal: "Total", thSpend: "Cost",
    thTime: "Time", thEmployee: "Employee", thModel: "Model", thDevice: "Device", thIp: "IP", thReqId: "request_id",
    empty: "No usage in this time range",
    emptySub: "Try another range. If you expect traffic, check that felag-server is new enough to attribute usage.",
    unattributed: "Unattributed",
    unattributedTip: "This request predates usage attribution — the gateway ledger has no employee for it",
    prev: "Previous", next: "Next",
    pageInfo: (p: number, n: number, total: number) => `Page ${p}/${n} · ${total} rows`,
    exported: (n: number) => `Exported ${n} rows`,
    noRows: "Nothing to export",
  },
};
type Dict = typeof I18N.zh;

// ── Ice Blue Enterprise 品牌值(bestfunc-design skill §1/§2/§5);平台 Tailwind 不认插件新 token → 走内联 style ──
const C = {
  signal: "#0A84FF", ink: "#071225", body: "#334155", muted: "#64748B",
  line: "#D8E2F0", surface: "#FFFFFF", surface2: "#F1F6FD", blueTint: "#EAF4FF",
  ok: "#1D9E75", warn: "#B45309",
};
const FZH = '"Noto Sans SC","PingFang SC",sans-serif';
const FMONO = '"JetBrains Mono",ui-monospace,monospace';
const SHADOW_CARD = "0 18px 45px rgba(7,18,37,.06)";
const AURORA =
  "radial-gradient(circle at 12% 0%, rgba(10,132,255,.08), transparent 28%)," +
  "radial-gradient(circle at 90% 10%, rgba(0,169,157,.07), transparent 30%)," +
  "linear-gradient(180deg,#F8FBFF 0%,#EEF4FB 100%)";

const eyebrow = (mb = 0): React.CSSProperties => ({
  fontFamily: FMONO, fontSize: 12, letterSpacing: ".16em", textTransform: "uppercase", color: C.signal, marginBottom: mb,
});
const btnPrimary: React.CSSProperties = { background: C.signal, color: "#fff", borderRadius: 999, fontFamily: FZH, fontWeight: 800, boxShadow: SHADOW_CARD, border: "none" };
const btnGhost: React.CSSProperties = { background: C.surface, border: `1px solid ${C.line}`, color: C.ink, borderRadius: 999, fontFamily: FZH, fontWeight: 700 };
const cardStyle: React.CSSProperties = { background: "rgba(255,255,255,.92)", border: `1px solid ${C.line}`, borderRadius: 22, boxShadow: SHADOW_CARD, overflow: "hidden" };
const thStyle: React.CSSProperties = { fontFamily: FMONO, fontSize: 12, letterSpacing: ".12em", textTransform: "uppercase", color: C.muted };
const inputStyle: React.CSSProperties = { border: `1px solid ${C.line}`, borderRadius: 14, color: C.ink, width: 148 };
const numCell: React.CSSProperties = { fontFamily: FMONO, textAlign: "right", color: C.ink };

interface AggRow {
  key: string | null; display_name: string; dept_name?: string;
  requests: number; prompt_tokens: number; completion_tokens: number; total_tokens: number; cost: number;
}
interface Totals { requests: number; prompt_tokens: number; completion_tokens: number; total_tokens: number; cost: number }
interface SummaryResp {
  group_by: string; rows: AggRow[]; totals: Totals; trend: AggRow[];
  models: string[]; unpriced_models: string[];
}
interface DetailRow {
  ts: string; user_id: string | null; display_name: string; dept_name?: string; model: string;
  prompt_tokens: number; completion_tokens: number; total_tokens: number; cost: number; peak: boolean;
  device: string | null; ip: string | null; request_id: string;
}
interface DetailResp { rows: DetailRow[]; page: number; page_size: number; total: number }

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

/** 本地日历日 YYYY-MM-DD。**必须按本地时区取**:toISOString() 是 UTC,
 *  北京时间凌晨 0-8 点用它会算成前一天,"今天"直接少一截。 */
function localDay(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const nf = new Intl.NumberFormat("en-US");
const fmt = (n: number) => nf.format(n ?? 0);
/** 人民币元。官方定价表就是按元报的,不做汇率换算。小额保留 4 位,大额到分即可。 */
const fmtCost = (n: number) => `¥${(n ?? 0).toFixed((n ?? 0) >= 1 ? 2 : 4)}`;

const GROUPS = ["employee", "department", "model", "day"] as const;
type Group = typeof GROUPS[number];

export default function TokenStats() {
  const lang = useCurrentLanguage();
  const t = (I18N as any)[lang === "en" ? "en" : "zh"] as Dict;

  const [from, setFrom] = useState(localDay(-6));
  const [to, setTo] = useState(localDay(0));
  const [model, setModel] = useState("");
  const [group, setGroup] = useState<Group>("employee");
  const [tab, setTab] = useState<"agg" | "detail">("agg");
  const [page, setPage] = useState(1);

  const [summary, setSummary] = useState<SummaryResp | null>(null);
  const [detail, setDetail] = useState<DetailResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const range = useMemo(
    () => ({ from, to, ...(model ? { model } : {}) }),
    [from, to, model],
  );

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      setSummary(await callNode<SummaryResp>("usage_summary", { ...range, group_by: group }, t));
    } catch (e: any) {
      toast.error(e.message || t.reqFail);
    } finally {
      setLoading(false);
    }
  }, [range, group, t]);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      setDetail(await callNode<DetailResp>("usage_detail", { ...range, page, page_size: 50 }, t));
    } catch (e: any) {
      toast.error(e.message || t.reqFail);
    } finally {
      setLoading(false);
    }
  }, [range, page, t]);

  useEffect(() => { if (tab === "agg") void loadSummary(); }, [tab, loadSummary]);
  useEffect(() => { if (tab === "detail") void loadDetail(); }, [tab, loadDetail]);
  // 改筛选条件后停在第 3 页会看到空表 —— 换范围就回第一页。
  useEffect(() => { setPage(1); }, [from, to, model]);

  const quick = (days: number) => { setFrom(localDay(-days)); setTo(localDay(0)); };

  const doExport = async () => {
    setExporting(true);
    try {
      const r = await callNode<{ csv: string; filename: string; rows: number }>("usage_export", range, t);
      if (!r.rows) { toast.error(t.noRows); return; }
      // 平台页面跑在浏览器里,导出直接在前端落盘,不经服务端存文件。
      const url = URL.createObjectURL(new Blob([r.csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url; a.download = r.filename; a.click();
      URL.revokeObjectURL(url);
      toast.success(t.exported(r.rows));
    } catch (e: any) {
      toast.error(e.message || t.reqFail);
    } finally {
      setExporting(false);
    }
  };

  const totals = summary?.totals;
  const trendMax = Math.max(1, ...(summary?.trend || []).map((r) => r.total_tokens));
  const pageCount = detail ? Math.max(1, Math.ceil(detail.total / detail.page_size)) : 1;

  const groupLabel: Record<Group, string> = {
    employee: t.byEmployee, department: t.byDepartment, model: t.byModel, day: t.byDay,
  };

  return (
    <div style={{ background: AURORA, minHeight: "100%", padding: "28px 24px", fontFamily: FZH, color: C.body }}>
      {/* ── 页头 ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <div style={{ maxWidth: 760 }}>
          <div style={eyebrow(6)}>{t.eyebrow}</div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: C.ink, margin: "0 0 10px" }}>{t.title}</h1>
          <p style={{ fontSize: 14, lineHeight: 1.75, color: C.body, margin: 0 }}>{t.lead}</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Button style={btnGhost} onClick={() => (tab === "agg" ? loadSummary() : loadDetail())} disabled={loading}>
            <RefreshCw size={15} style={{ marginRight: 6 }} />{t.refresh}
          </Button>
          <Button style={btnPrimary} onClick={doExport} disabled={exporting}>
            <FileText size={15} style={{ marginRight: 6 }} />{exporting ? t.exporting : t.export}
          </Button>
        </div>
      </div>

      {/* ── 筛选条 ── */}
      <div style={{ ...cardStyle, padding: 16, marginBottom: 18, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <Button style={btnGhost} onClick={() => quick(0)}>{t.today}</Button>
        <Button style={btnGhost} onClick={() => quick(6)}>{t.d7}</Button>
        <Button style={btnGhost} onClick={() => quick(29)}>{t.d30}</Button>
        <Input type="date" value={from} onChange={(e: any) => setFrom(e.target.value)} style={inputStyle} />
        <span style={{ color: C.muted }}>{t.to}</span>
        <Input type="date" value={to} onChange={(e: any) => setTo(e.target.value)} style={inputStyle} />
        <Select value={model || "__all__"} onValueChange={(v: string) => setModel(v === "__all__" ? "" : v)}>
          <SelectTrigger style={{ ...inputStyle, width: 200 }}><SelectValue placeholder={t.allModels} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t.allModels}</SelectItem>
            {(summary?.models || []).map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* ── 汇总卡 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14, marginBottom: 18 }}>
        {[
          { label: t.cardTotal, value: fmt(totals?.total_tokens || 0), accent: true },
          { label: t.cardReq, value: fmt(totals?.requests || 0) },
          { label: t.cardIn, value: fmt(totals?.prompt_tokens || 0) },
          { label: t.cardOut, value: fmt(totals?.completion_tokens || 0) },
          { label: t.cardSpend, value: fmtCost(totals?.cost || 0), hint: t.spendHint },
        ].map((c) => (
          <div key={c.label} style={{ ...cardStyle, padding: "18px 20px", background: c.accent ? C.blueTint : "rgba(255,255,255,.92)" }}>
            <div style={eyebrow(8)}>{c.label}</div>
            <div style={{ fontFamily: FMONO, fontSize: 26, fontWeight: 800, color: C.ink }}>{c.value}</div>
            {c.hint && <div style={{ fontSize: 11, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>{c.hint}</div>}
          </div>
        ))}
      </div>

      {/* 有模型没配单价 → 它的成本被算成 0,必须点名,否则"0 元"会被读成"没花钱" */}
      {!!summary?.unpriced_models?.length && (
        <div style={{ ...cardStyle, padding: "12px 18px", marginBottom: 18, background: "#FEF3C7", borderColor: C.warn }}>
          <span style={{ color: C.warn, fontSize: 13 }}>{t.unpricedWarn(summary.unpriced_models.join("、"))}</span>
        </div>
      )}

      {/* ── 每日趋势(纯 CSS 条形,不引图表库) ── */}
      <div style={{ ...cardStyle, padding: "18px 20px", marginBottom: 18 }}>
        <div style={eyebrow(14)}>{t.trend}</div>
        {summary?.trend?.length ? (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 120 }}>
            {summary.trend.map((d) => (
              <div key={String(d.key)} style={{ flex: 1, textAlign: "center", minWidth: 0 }} title={`${d.key} · ${fmt(d.total_tokens)}`}>
                <div style={{
                  height: Math.max(2, Math.round((d.total_tokens / trendMax) * 96)),
                  background: `linear-gradient(180deg, ${C.signal}, ${C.signal}88)`,
                  borderRadius: "6px 6px 0 0",
                }} />
                <div style={{ fontFamily: FMONO, fontSize: 10, color: C.muted, marginTop: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {String(d.key ?? "").slice(5)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: C.muted, fontSize: 13 }}>{t.trendEmpty}</div>
        )}
      </div>

      {/* ── 视图切换 ── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        {(["agg", "detail"] as const).map((k) => (
          <Button key={k} style={tab === k ? btnPrimary : btnGhost} onClick={() => setTab(k)}>
            {k === "agg" ? t.tabAgg : t.tabDetail}
          </Button>
        ))}
        {tab === "agg" && (
          <div style={{ display: "flex", gap: 8, marginLeft: 8 }}>
            {GROUPS.map((g) => (
              <Button key={g} style={group === g ? { ...btnGhost, borderColor: C.signal, color: C.signal } : btnGhost}
                onClick={() => setGroup(g)}>{groupLabel[g]}</Button>
            ))}
          </div>
        )}
      </div>

      {/* ── 表格 ── */}
      <div style={cardStyle}>
        {tab === "agg" ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead style={thStyle}>{t.thName}</TableHead>
                {group === "employee" && <TableHead style={thStyle}>{t.thDept}</TableHead>}
                <TableHead style={{ ...thStyle, textAlign: "right" }}>{t.thReq}</TableHead>
                <TableHead style={{ ...thStyle, textAlign: "right" }}>{t.thIn}</TableHead>
                <TableHead style={{ ...thStyle, textAlign: "right" }}>{t.thOut}</TableHead>
                <TableHead style={{ ...thStyle, textAlign: "right" }}>{t.thTotal}</TableHead>
                <TableHead style={{ ...thStyle, textAlign: "right" }}>{t.thSpend}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(summary?.rows || []).map((r) => (
                <TableRow key={String(r.key)}>
                  <TableCell style={{ color: C.ink, fontWeight: 600 }}>
                    {r.display_name || t.unattributed}
                    {!r.key && <Badge style={{ marginLeft: 8, background: C.surface2, color: C.muted, border: `1px solid ${C.line}` }} title={t.unattributedTip}>{t.unattributed}</Badge>}
                  </TableCell>
                  {group === "employee" && <TableCell style={{ color: C.body }}>{r.dept_name || "—"}</TableCell>}
                  <TableCell style={numCell}>{fmt(r.requests)}</TableCell>
                  <TableCell style={numCell}>{fmt(r.prompt_tokens)}</TableCell>
                  <TableCell style={numCell}>{fmt(r.completion_tokens)}</TableCell>
                  <TableCell style={{ ...numCell, fontWeight: 800 }}>{fmt(r.total_tokens)}</TableCell>
                  <TableCell style={numCell}>{fmtCost(r.cost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead style={thStyle}>{t.thTime}</TableHead>
                <TableHead style={thStyle}>{t.thEmployee}</TableHead>
                <TableHead style={thStyle}>{t.thDept}</TableHead>
                <TableHead style={thStyle}>{t.thModel}</TableHead>
                <TableHead style={{ ...thStyle, textAlign: "right" }}>{t.thIn}</TableHead>
                <TableHead style={{ ...thStyle, textAlign: "right" }}>{t.thOut}</TableHead>
                <TableHead style={{ ...thStyle, textAlign: "right" }}>{t.thTotal}</TableHead>
                <TableHead style={{ ...thStyle, textAlign: "right" }}>{t.thSpend}</TableHead>
                <TableHead style={thStyle} title={t.peakTip}>{t.thPeak}</TableHead>
                <TableHead style={thStyle}>{t.thDevice}</TableHead>
                <TableHead style={thStyle}>{t.thIp}</TableHead>
                <TableHead style={thStyle}>{t.thReqId}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(detail?.rows || []).map((r) => (
                <TableRow key={r.request_id}>
                  <TableCell style={{ fontFamily: FMONO, fontSize: 12, color: C.body, whiteSpace: "nowrap" }}>{r.ts}</TableCell>
                  <TableCell style={{ color: C.ink, fontWeight: 600 }} title={r.user_id ? "" : t.unattributedTip}>
                    {r.display_name || t.unattributed}
                  </TableCell>
                  <TableCell style={{ color: C.body }}>{r.dept_name || "—"}</TableCell>
                  <TableCell style={{ fontFamily: FMONO, fontSize: 12 }}>{r.model}</TableCell>
                  <TableCell style={numCell}>{fmt(r.prompt_tokens)}</TableCell>
                  <TableCell style={numCell}>{fmt(r.completion_tokens)}</TableCell>
                  <TableCell style={{ ...numCell, fontWeight: 800 }}>{fmt(r.total_tokens)}</TableCell>
                  <TableCell style={numCell}>{fmtCost(r.cost)}</TableCell>
                  <TableCell>
                    <Badge style={{
                      background: r.peak ? "#FEF3C7" : C.surface2,
                      color: r.peak ? C.warn : C.muted,
                      border: `1px solid ${r.peak ? C.warn : C.line}`,
                    }} title={t.peakTip}>{r.peak ? t.peak : t.offPeak}</Badge>
                  </TableCell>
                  <TableCell style={{ color: C.body }}>{r.device || "—"}</TableCell>
                  <TableCell style={{ fontFamily: FMONO, fontSize: 12, color: C.muted }}>{r.ip || "—"}</TableCell>
                  <TableCell style={{ fontFamily: FMONO, fontSize: 11, color: C.muted, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }} title={r.request_id}>
                    {r.request_id}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* 空态 */}
        {!loading && (tab === "agg" ? !summary?.rows?.length : !detail?.rows?.length) && (
          <div style={{ padding: "48px 24px", textAlign: "center" }}>
            <div style={{ color: C.ink, fontWeight: 700, marginBottom: 8 }}>{t.empty}</div>
            <div style={{ color: C.muted, fontSize: 13, lineHeight: 1.7 }}>{t.emptySub}</div>
          </div>
        )}

        {/* 明细分页 */}
        {tab === "detail" && !!detail?.total && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", borderTop: `1px solid ${C.line}` }}>
            <span style={{ fontFamily: FMONO, fontSize: 12, color: C.muted }}>{t.pageInfo(detail.page, pageCount, detail.total)}</span>
            <div style={{ display: "flex", gap: 8 }}>
              <Button style={btnGhost} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t.prev}</Button>
              <Button style={btnGhost} disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>{t.next}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
