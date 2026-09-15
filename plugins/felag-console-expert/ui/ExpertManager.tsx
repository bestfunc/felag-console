import { useState, useEffect, useCallback } from "react";
import { Button, Input, Label, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
  Badge, toast, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  useCurrentLanguage } from "@platform/ui";
import { Plus, RefreshCw, Check, X, Archive, FileText } from "lucide-react";

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
    scopePh: "如 dept-3 或 pos-7",
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
    scopePh: "e.g. dept-3 or pos-7",
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

async function callNode(nodeKey: string, params: any, t: any) {
  const res = await fetch(`/api/plugins/${SLUG}/nodes/${nodeKey}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ params }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) throw new Error(data?.error || data?.message || t.reqFail);
  return data?.result ?? data;
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await callNode("expert_list", {}, t);
      setRows(r?.experts || []);
    } catch (e: any) {
      toast.error(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

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
              <TableCell style={{ fontFamily: "monospace", fontSize: 12 }}>{r.scope_ref}</TableCell>
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
                      <Archive size={13} style={{ marginRight: 4 }} />{t.deprecate}
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
              <Input value={scope} placeholder={t.scopePh} onChange={(e: any) => setScope(e.target.value)} />
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
