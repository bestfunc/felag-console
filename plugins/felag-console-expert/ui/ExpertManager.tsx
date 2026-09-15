import { useState, useEffect, useCallback } from "react";
import { Button, Label, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
  Badge, toast, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  useCurrentLanguage } from "@platform/ui";
import { Plus, RefreshCw, Check, X, Ban, FileText } from "lucide-react";

const SLUG = "felag-console-expert";

// i18n:单文件 tsx 插件自带轻量语言包;useCurrentLanguage() 随平台切换响应式返回 'zh'|'en'。
// 模块级函数(callNode)拿不到 hook,要用到文案就把 t 传进去。
const I18N = {
  zh: {
    title: "专家管理", refresh: "刷新", newExpert: "新建专家",
    thName: "名称", thProfession: "职业", thScope: "作用域", thVersion: "版本",
    thStatus: "状态", thActions: "操作",
    draft: "草稿", pending: "待审", published: "已发布", rejected: "已驳回", deprecated: "已下架",
    detail: "详情", approve: "通过发布", reject: "驳回", deprecate: "下架",
    empty: "暂无专家",
    editTitle: "专家 EXPERT.md", scopeLabel: "发布作用域（部门或岗位）",
    cascaderHint: "点一个部门或岗位；选部门 = 该部门全体",
    colEmpty: "无下级", selectedPrefix: "已选：",
    noScopes: "你名下没有可管理的部门或岗位，无法发布专家",
    bodyLabel: "EXPERT.md 全文（frontmatter + 系统提示词）",
    save: "保存（提交待审）", saving: "保存中…", cancel: "取消",
    needBody: "请填写 EXPERT.md 内容", needScope: "请填写发布作用域",
    saved: "已保存，进入待审", approved: "已发布", rejectedDone: "已驳回", deprecated2: "已下架",
    rejectReason: "驳回原因（可选）",
    reqFail: "请求失败",
    // 这条必须显示出来:管理员普遍以为「下架」= 从所有客户端收回
    deprecateNote: "下架只停止继续下发；已装到客户端的副本不会被远程删除。",
    tplHint: "留空会用模板起一份；字段说明见 felag-client/docs/EXPERT-SPEC.md",
  },
  en: {
    title: "Expert Management", refresh: "Refresh", newExpert: "New Expert",
    thName: "Name", thProfession: "Profession", thScope: "Scope", thVersion: "Version",
    thStatus: "Status", thActions: "Actions",
    draft: "Draft", pending: "Pending", published: "Published", rejected: "Rejected", deprecated: "Deprecated",
    detail: "Details", approve: "Approve", reject: "Reject", deprecate: "Deprecate",
    empty: "No experts yet",
    editTitle: "Expert EXPERT.md", scopeLabel: "Publish scope (department or position)",
    cascaderHint: "Pick a department or position; a department means everyone in it",
    colEmpty: "No children", selectedPrefix: "Selected: ",
    noScopes: "You manage no department or position, so you cannot publish an expert",
    bodyLabel: "Full EXPERT.md (frontmatter + system prompt)",
    save: "Save (submit for review)", saving: "Saving…", cancel: "Cancel",
    needBody: "EXPERT.md content is required", needScope: "Publish scope is required",
    saved: "Saved, pending review", approved: "Published", rejectedDone: "Rejected", deprecated2: "Deprecated",
    rejectReason: "Reason (optional)",
    reqFail: "Request failed",
    deprecateNote: "Deprecating only stops further distribution; copies already installed on clients are not removed remotely.",
    tplHint: "Leave blank to start from a template; see felag-client/docs/EXPERT-SPEC.md",
  },
};

const TEMPLATE = `---
name: my-expert
displayName: 专家显示名
profession: 职业头衔
description: 一句话说明它能干什么
version: 0.1.0
avatar: 专
tags:
  - 标签一
skills: []
connectors: []
defaultInitPrompt: 输入框里的引导语
quickPrompts:
  - 推荐提问一
---

（正文即系统提示词：写清这个岗位的判断顺序、硬规矩、输出习惯。
  注意：不要在这里声明"自动执行不可逆操作" —— 审批护栏在客户端壳层，
  提示词改不了它，写了只会让用户误以为可以。）
`;

// 平台的节点调用只有这一条路径：`/api/dag/<slug>/<node>`，params 直接作为 body。
// 响应是三层信封 {code, message, data:{results:[{output:{result}, error}]}} ——
// **HTTP 恒为 200**，节点抛异常也是 200，错误只在 code / results[0].error 里。
// 所以不能拿 res.ok 当成败判据，否则节点报错会被当成成功、返回 undefined。
async function callNode<T>(node: string, params: object, t: any): Promise<T> {
  const resp = await fetch(`/api/dag/${SLUG}/${node}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
  });
  const env = await resp.json();
  const first = env?.data?.results?.[0];
  if (env?.code !== 0 || first?.error) {
    const raw = first?.error || env?.message || t.reqFail;
    // 节点抛的是 Python 异常，整段 traceback 弹到 toast 里人没法看，只抽末尾那句。
    const m = String(raw).match(/(?:ValueError|RuntimeError|NodeError|TypeError):\s*([^\n]+)/);
    throw new Error(m ? m[1].trim() : String(raw));
  }
  return first?.output?.result as T;
}

type Scope = { scope_ref: string; label: string; parent_ref?: string | null };

// 作用域列式级联（changeOnSelect）：点任一节点 = 直接选中它，有子级则右侧展开供细选。
// 不让人手输 scope_ref：它得是 `dept:<id>` / `pos:<id>`，与 server 端 EntitledScopes
// 产的串逐字节一致。手输成 `dept-3` 这种形态会发布成功、下发侧永远匹配不上，而且不报错。
function ScopeCascader({ scopes, value, onChange, t }: {
  scopes: Scope[]; value: string; onChange: (ref: string) => void; t: any;
}) {
  const [path, setPath] = useState<string[]>([]);
  const byRef: Record<string, Scope> = {};
  scopes.forEach((x) => { byRef[x.scope_ref] = x; });
  const refset = new Set(scopes.map((x) => x.scope_ref));
  const isRoot = (x: Scope) => !x.parent_ref || !refset.has(x.parent_ref);
  const childrenOf = (ref: string) =>
    scopes.filter((x) => x.parent_ref === ref).sort((a, b) => a.label.localeCompare(b.label));

  const roots = scopes.filter(isRoot).sort((a, b) => a.label.localeCompare(b.label));
  const columns: Scope[][] = [roots];
  for (const q of path) { const kids = childrenOf(q); if (kids.length) columns.push(kids); }

  const pick = (ci: number, n: Scope) => {
    onChange(n.scope_ref);
    const kids = childrenOf(n.scope_ref);
    setPath((prev) => (kids.length ? [...prev.slice(0, ci), n.scope_ref] : prev.slice(0, ci)));
  };

  const selLabel = (ref: string) => {
    const n = byRef[ref]; if (!n) return ref;
    const par = n.parent_ref ? byRef[n.parent_ref] : undefined;
    return (par ? par.label + " / " : "") + n.label;
  };

  if (scopes.length === 0) {
    return <div style={{ fontSize: 12, color: "#B45309" }}>{t.noScopes}</div>;
  }
  return (
    <div>
      <div style={{ overflowX: "auto", border: "1px solid #D8E2F0", borderRadius: 12, background: "#fff" }}>
        <div style={{ display: "flex", minWidth: "min-content" }}>
          {columns.map((col, ci) => (
            <div key={ci} style={{ flex: "0 0 168px", width: 168, maxHeight: 220, overflowY: "auto",
              borderRight: ci < columns.length - 1 ? "1px solid #F1F6FD" : "none" }}>
              {col.length === 0 && (
                <div style={{ padding: 10, fontSize: 12, color: "#94a3b8" }}>{t.colEmpty}</div>
              )}
              {col.map((n) => {
                const kids = childrenOf(n.scope_ref);
                const selected = value === n.scope_ref;
                const opened = path[ci] === n.scope_ref;
                return (
                  <div key={n.scope_ref} onClick={() => pick(ci, n)}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6,
                      padding: "8px 10px", cursor: "pointer", fontSize: 13,
                      color: selected ? "#0A84FF" : "#071225",
                      fontWeight: selected ? 700 : 500,
                      background: selected ? "#EAF4FF" : opened ? "#F1F6FD" : "#fff",
                      borderBottom: "1px solid #F1F6FD" }}>
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.label}</span>
                    {kids.length > 0 && (
                      <span style={{ flexShrink: 0, fontFamily: "monospace", fontSize: 11,
                        color: opened ? "#0A84FF" : "#64748B", background: opened ? "#EAF4FF" : "#F1F6FD",
                        border: `1px solid ${opened ? "#0A84FF55" : "#D8E2F0"}`, borderRadius: 999, padding: "1px 7px" }}>
                        {kids.length}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 6, fontFamily: "monospace", fontSize: 12, color: value ? "#0A84FF" : "#94a3b8" }}>
        {value ? t.selectedPrefix + selLabel(value) : t.cascaderHint}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const lang = useCurrentLanguage();
  const t = I18N[lang === "en" ? "en" : "zh"];
  const map: Record<string, [string, string]> = {
    draft: [t.draft, "secondary"],
    pending: [t.pending, "outline"],
    published: [t.published, "default"],
    rejected: [t.rejected, "destructive"],
    deprecated: [t.deprecated, "secondary"],
  };
  const [label, variant] = map[status] || [status, "secondary"];
  return <Badge variant={variant as any}>{label}</Badge>;
}

export default function ExpertManager() {
  const lang = useCurrentLanguage();
  const t = I18N[lang === "en" ? "en" : "zh"];

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [scope, setScope] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [scopes, setScopes] = useState<Scope[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 两个节点并发：可管作用域是编辑弹窗的前置，晚一拍拿会让级联第一眼是空的。
      const [lst, ctx] = await Promise.all([
        callNode<{ experts: any[] }>("expert_list", {}, t),
        callNode<{ manageable_scopes: Scope[] }>("actor_context", {}, t),
      ]);
      setRows(lst?.experts || []);
      setScopes(ctx?.manageable_scopes || []);
    } catch (e: any) {
      toast.error(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  // scope_ref（dept:12 / pos:1）→ 组织名；没匹配上就回退显原码，
  // 回退本身就是个信号：说明这条的作用域不在你可管范围内、或者部门已被删。
  const scopeName = (ref: string) => scopes.find((x) => x.scope_ref === ref)?.label || ref;

  async function openNew() {
    setEditing(null); setScope(""); setBody(TEMPLATE); setOpen(true);
  }

  async function openDetail(row: any) {
    try {
      const r = await callNode("expert_detail", { expert_id: row.id }, t);
      setEditing(r?.expert || row);
      setScope(row.scope_ref || "");
      // 回显**整份 EXPERT.md**(不是解析后的字段):编辑对象就是这份文件本身,
      // 拆成表单再拼回去必然丢掉正文里的排版与注释。
      setBody(r?.expert?.body || "");
      setOpen(true);
    } catch (e: any) {
      toast.error(String(e.message || e));
    }
  }

  async function save() {
    if (!body.trim()) return toast.error(t.needBody);
    if (!scope.trim()) return toast.error(t.needScope);
    setSaving(true);
    try {
      await callNode("expert_save",
        { expert_id: editing?.id, scope_ref: scope.trim(), body }, t);
      toast.success(t.saved);
      setOpen(false);
      load();
    } catch (e: any) {
      toast.error(String(e.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function review(row: any, approve: boolean) {
    try {
      const reason = approve ? undefined : (window.prompt(t.rejectReason) || undefined);
      await callNode("expert_review", { expert_id: row.id, approve, reason }, t);
      toast.success(approve ? t.approved : t.rejectedDone);
      load();
    } catch (e: any) {
      toast.error(String(e.message || e));
    }
  }

  async function deprecate(row: any) {
    try {
      const r = await callNode("expert_deprecate", { expert_id: row.id }, t);
      // 把「已装的不会被删」这句透给管理员,不要只 toast 一个"已下架"
      toast.success(`${t.deprecated2} — ${r?.note || t.deprecateNote}`);
      load();
    } catch (e: any) {
      toast.error(String(e.message || e));
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{t.title}</h2>
        <div style={{ flex: 1 }} />
        <Button variant="outline" onClick={load} disabled={loading}>
          <RefreshCw size={14} style={{ marginRight: 6 }} />{t.refresh}
        </Button>
        <Button onClick={openNew}>
          <Plus size={14} style={{ marginRight: 6 }} />{t.newExpert}
        </Button>
      </div>

      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>{t.deprecateNote}</div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t.thName}</TableHead>
            <TableHead>{t.thProfession}</TableHead>
            <TableHead>{t.thScope}</TableHead>
            <TableHead>{t.thVersion}</TableHead>
            <TableHead>{t.thStatus}</TableHead>
            <TableHead>{t.thActions}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow><TableCell colSpan={6} style={{ color: "#94a3b8" }}>{t.empty}</TableCell></TableRow>
          ) : rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell style={{ fontWeight: 600 }}>{r.display_name}<br />
                <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace" }}>{r.name}</span>
              </TableCell>
              <TableCell>{r.profession}</TableCell>
              <TableCell style={{ fontSize: 13 }}>{scopeName(r.scope_ref)}</TableCell>
              <TableCell style={{ fontFamily: "monospace", fontSize: 12 }}>{r.version}</TableCell>
              <TableCell><StatusBadge status={r.status} /></TableCell>
              <TableCell>
                <div style={{ display: "flex", gap: 6 }}>
                  <Button size="sm" variant="outline" onClick={() => openDetail(r)}>
                    <FileText size={13} style={{ marginRight: 4 }} />{t.detail}
                  </Button>
                  {r.status === "pending" && (
                    <>
                      <Button size="sm" onClick={() => review(r, true)}>
                        <Check size={13} style={{ marginRight: 4 }} />{t.approve}
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => review(r, false)}>
                        <X size={13} style={{ marginRight: 4 }} />{t.reject}
                      </Button>
                    </>
                  )}
                  {r.status === "published" && (
                    <Button size="sm" variant="outline" onClick={() => deprecate(r)}>
                      <Ban size={13} style={{ marginRight: 4 }} />{t.deprecate}
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent style={{ maxWidth: 820 }}>
          <DialogHeader><DialogTitle>{t.editTitle}</DialogTitle></DialogHeader>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <Label>{t.scopeLabel}</Label>
              <ScopeCascader scopes={scopes} value={scope} onChange={setScope} t={t} />
            </div>
            <div>
              <Label>{t.bodyLabel}</Label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                spellCheck={false}
                style={{
                  width: "100%", height: 420, fontFamily: "monospace", fontSize: 12.5,
                  lineHeight: 1.6, padding: 10, border: "1px solid #e2e8f0", borderRadius: 8,
                  outline: "none", resize: "vertical",
                }}
              />
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>{t.tplHint}</div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t.cancel}</Button>
            <Button onClick={save} disabled={saving}>{saving ? t.saving : t.save}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
