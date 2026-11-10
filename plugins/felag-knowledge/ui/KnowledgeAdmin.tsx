import {useEffect, useState} from "react";

type Item = {file: string; title: string; category: string; summary: string; tags?: string[]; sha256: string; size: number};
type Library = {version: string; revision: number; dirty: boolean; items: Item[]; published: Item[]};
type Editor = {existing?: Item; title: string; category: string; summary: string; tags: string; file?: File};
const empty = (): Editor => ({title: "", category: "手册", summary: "", tags: ""});
const chunkSize = 4 * 1024 * 1024;

async function call<T>(params: object): Promise<T> {
  const response = await fetch("/api/dag/felag-knowledge/library", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(params),
  });
  const data = await response.json().catch(() => null);
  const row = data?.data?.results?.[0];
  if (!response.ok || data?.code !== 0 || row?.error || row?.output?.result == null) {
    const raw = String(row?.error || data?.message || `请求失败（HTTP ${response.status}）`);
    const detail = raw.match(/(?:PermissionError|RuntimeError|ValueError|NodeError):\s*([^\n]+)/);
    throw new Error(detail?.[1] || raw);
  }
  return row.output.result as T;
}

async function upload(file: File, name: string, progress: (value: number) => void) {
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
  let sha = "";
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    const part = file.slice(offset, offset + chunkSize);
    const chunk = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
      reader.onerror = () => reject(new Error("无法读取所选文件"));
      reader.readAsDataURL(part);
    });
    const result = await call<{offset: number; sha256?: string}>({action: "upload", id, file: name, offset, total: file.size, chunk});
    if (result.offset !== offset + part.size) throw new Error("上传进度异常，请重新选择文件");
    progress(Math.round(result.offset / file.size * 100));
    if (result.sha256) sha = result.sha256;
  }
  if (!sha) throw new Error("上传未完成");
  return sha;
}

const sizeLabel = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MiB` : `${Math.max(1, Math.round(bytes / 1024))} KiB`;
const isVideo = (file: string) => /\.(mp4|webm)$/.test(file);

export default function KnowledgeAdmin() {
  const [library, setLibrary] = useState<Library>();
  const [editor, setEditor] = useState<Editor>();
  const [view, setView] = useState<"draft" | "published">("draft");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<{item?: Item}>();

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setError("");
    setNotice("");
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); setProgress(undefined); }
  };
  const refresh = () => run("刷新", async () => setLibrary(await call<Library>({action: "state"})));
  useEffect(() => { void refresh(); }, []);

  const edit = (item: Item) => {
    setError("");
    setNotice("");
    setEditor({existing: item, title: item.title, category: item.category, summary: item.summary, tags: (item.tags ?? []).join("，")});
  };
  const newItem = () => { setEditor(empty()); setError(""); setNotice(""); };
  const save = () => {
    if (!editor || !library) return;
    void run("保存", async () => {
      const {existing, file} = editor;
      const title = editor.title.trim();
      const category = editor.category.trim();
      if (!title || !category) throw new Error("请填写标题和分类");
      const tags = [...new Set(editor.tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean))];
      if (tags.length > 12 || tags.some(tag => tag.length > 24)) throw new Error("最多填写 12 个标签，每个标签最多 24 个字符");
      let name = existing?.file ?? "";
      let sha256 = existing?.sha256 ?? "";
      if (file) {
        const ext = file.name.toLowerCase().match(/\.(md|txt|mp4|webm)$/)?.[0];
        if (!ext) throw new Error("请上传 Markdown、TXT、MP4 或 WebM");
        if (!file.size || file.size > (isVideo(ext) ? 256 * 1048576 : 128 * 1024)) {
          throw new Error("视频限 256 MiB，文本限 128 KiB，文件不能为空");
        }
        if (existing && !existing.file.endsWith(ext)) throw new Error("替换文件时须使用相同格式");
        if (!name) {
          const stem = file.name.slice(0, -ext.length).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[-_]+|[-_]+$/g, "").slice(0, 54);
          const suffix = crypto.getRandomValues(new Uint32Array(2)).join("-");
          name = `${stem || "resource"}-${suffix}${ext}`;
        }
        setProgress(0);
        sha256 = await upload(file, name, setProgress);
      }
      if (!sha256) throw new Error("请选择资料文件");
      const next = await call<Library>({action: "save", revision: library.revision, item: {
        file: name, title, category, summary: editor.summary.trim(), tags, sha256,
      }});
      setLibrary(next);
      setEditor(undefined);
      setNotice("已保存到草稿");
    });
  };

  const confirmAction = () => {
    if (!confirm || !library) return;
    const item = confirm.item;
    setConfirm(undefined);
    void run(item ? "移除" : "发布", async () => {
      const next = await call<Library>(item
        ? {action: "remove", revision: library.revision, file: item.file}
        : {action: "publish", revision: library.revision});
      setLibrary(next);
      if (item?.file === editor?.existing?.file) setEditor(undefined);
      if (!item) setView("published");
      setNotice(item ? "已从草稿移除，发布后才会对客户端生效" : `已发布 v${next.version}，客户端同步后即可使用`);
    });
  };

  const term = query.trim().toLowerCase();
  const items = (view === "draft" ? library?.items : library?.published) ?? [];
  const visible = items.filter(item => [item.title, item.category, ...(item.tags ?? [])].join(" ").toLowerCase().includes(term));
  return <main className="fk-admin">
    <style>{styles}</style>
    <header className="fk-hero">
      <div><p className="fk-kicker">FÉLAG / 资料管理</p><h1>知识库维护</h1><p>整理工作站手册、案例和教学视频，发布后供用户和 AI 同步使用。</p></div>
      <div className="fk-release"><span>当前已发布</span><strong>{library ? `v${library.version}` : "—"}</strong></div>
    </header>
    <div className="fk-toolbar">
      <div className="fk-tabs" aria-label="资料版本">
        <button aria-pressed={view === "draft"} onClick={() => setView("draft")} disabled={!!busy}>草稿 {library?.dirty && <span className="fk-dot" aria-label="有未发布修改"/>}</button>
        <button aria-pressed={view === "published"} onClick={() => setView("published")} disabled={!!busy}>已发布</button>
      </div>
      <div className="fk-actions">
        <button className="fk-btn" onClick={refresh} disabled={!!busy}>刷新</button>
        {view === "draft" && <button className="fk-btn" onClick={newItem} disabled={!!busy || !library}>新增资料</button>}
        <button className="fk-btn fk-primary" onClick={() => setConfirm({})} disabled={!!busy || !library?.dirty || !!editor}>发布新版</button>
      </div>
    </div>
    {(error || notice) && <div className={`fk-message ${error ? "fk-error" : ""}`} role={error ? "alert" : "status"}>{error || notice}</div>}
    {confirm && <section className="fk-confirm" role="alert">
      <strong>{confirm.item ? `移除「${confirm.item.title}」？` : "将当前草稿发布为新版？"}</strong>
      <span>{confirm.item ? "变更随下一版生效。" : `新版将包含当前草稿中的 ${library?.items.length ?? 0} 份资料。`}</span>
      <div className="fk-actions"><button className="fk-btn" onClick={() => setConfirm(undefined)}>取消</button>
        <button className="fk-btn fk-primary" onClick={confirmAction} disabled={!!busy}>{confirm.item ? "确认移除" : "确认发布"}</button></div>
    </section>}
    <div className={`fk-grid${editor ? " fk-editing" : ""}`}>
      <section className="fk-panel" aria-label="资料列表">
        <div className="fk-list-head"><div><h2>{view === "draft" ? "草稿资料" : "已发布资料"}</h2><p>{items.length} 份资料{view === "draft" && library?.dirty ? " · 有未发布修改" : ""}</p></div>
          <input className="fk-input" type="search" aria-label="搜索资料" placeholder="搜索标题、分类或标签" value={query} onChange={e => setQuery(e.target.value)}/>
        </div>
        {visible.map(item => <div className="fk-row" key={item.file}>
          <span className={`fk-kind${isVideo(item.file) ? " fk-video" : ""}`} aria-hidden="true">{isVideo(item.file) ? "▶" : "▤"}</span>
          <div className="fk-item"><strong>{item.title}</strong><p>{item.summary || item.file}</p><small>{[item.category, sizeLabel(item.size), ...(item.tags ?? [])].join(" · ")}</small></div>
          {view === "draft" && <div className="fk-actions fk-row-actions">
            <button className="fk-btn" onClick={() => edit(item)} disabled={!!busy}>编辑</button>
            <button className="fk-btn fk-remove" onClick={() => setConfirm({item})} disabled={!!busy || !!editor}>移除</button>
          </div>}
        </div>)}
        {!visible.length && <p className="fk-empty">{busy === "刷新" ? "正在读取资料…" : !library ? "资料暂不可用" : items.length ? "没有匹配的资料" : "此版本暂无资料"}</p>}
      </section>
      {editor && <form className="fk-panel fk-form" onSubmit={e => { e.preventDefault(); save(); }}>
        <h2>{editor.existing ? "编辑资料" : "新增资料"}</h2>
        <p>保存后的修改进入草稿。</p>
        <label>标题<input className="fk-input" maxLength={100} value={editor.title} onChange={e => setEditor({...editor, title: e.target.value})} required disabled={!!busy}/></label>
        <label>分类<input className="fk-input" list="fk-categories" maxLength={30} value={editor.category} onChange={e => setEditor({...editor, category: e.target.value})} required disabled={!!busy}/></label>
        <datalist id="fk-categories">{[...new Set(["手册", "案例", "视频", ...(library?.items ?? []).map(i => i.category)])].map(c => <option key={c} value={c}/>)}</datalist>
        <label>摘要<textarea className="fk-input" rows={3} maxLength={500} value={editor.summary} onChange={e => setEditor({...editor, summary: e.target.value})} disabled={!!busy}/></label>
        <label>标签<input className="fk-input" placeholder="例如：快速入门，AI 参考" value={editor.tags} onChange={e => setEditor({...editor, tags: e.target.value})} disabled={!!busy}/></label>
        <label>{editor.existing ? "替换文件（可选）" : "上传文件"}
          <input className="fk-input" key={editor.existing?.file ?? "new"} type="file" accept=".md,.txt,.mp4,.webm" disabled={!!busy}
            onChange={e => setEditor({...editor, file: e.target.files?.[0]})} required={!editor.existing}/>
        </label>
        <small>Markdown / TXT ≤ 128 KiB · MP4 / WebM ≤ 256 MiB</small>
        {progress != null && <div className="fk-progress"><progress value={progress} max={100}/><span>{progress}%</span></div>}
        <div className="fk-actions"><button type="button" className="fk-btn" onClick={() => setEditor(undefined)} disabled={!!busy}>取消</button>
          <button className="fk-btn fk-primary" disabled={!!busy}>{busy === "保存" ? "正在保存…" : "保存草稿"}</button></div>
      </form>}
    </div>
  </main>;
}

const styles = `
.fk-admin { max-width: 1330px; margin: 0 auto; padding: 24px; color: #192c46; font-size: 14px; }
.fk-hero { display: flex; justify-content: space-between; gap: 20px; align-items: flex-end; border-radius: 14px; background: #172944; color: #f6f8ff; padding: clamp(18px, 3vw, 32px); }
.fk-hero h1 { margin: 5px 0 7px; font-size: clamp(24px, 3vw, 34px); font-weight: 750; letter-spacing: -.035em; }
.fk-hero p { margin: 0; color: #c6d3eb; }
.fk-hero .fk-kicker { color: #9dc2fc; letter-spacing: .12em; font-weight: 700; font-size: 11px; }
.fk-release { display: grid; gap: 3px; min-width: 96px; border: 1px solid #8199ba65; border-radius: 8px; padding: 8px 12px; }
.fk-release span { color: #c6d3eb; font-size: 11px; }
.fk-release strong { font-weight: 700; }
.fk-toolbar, .fk-list-head { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
.fk-toolbar { margin: 16px 0; }
.fk-tabs, .fk-actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.fk-admin button { font: inherit; cursor: pointer; }
.fk-admin button:disabled { opacity: .48; cursor: default; }
.fk-tabs button { display: flex; align-items: center; gap: 6px; background: transparent; border: 1px solid transparent; border-radius: 7px; color: #4a5c75; padding: 7px 12px; }
.fk-tabs button[aria-pressed="true"] { color: #234c99; border-color: #c8d9f9; background: #e8efff; font-weight: 650; }
.fk-dot { width: 7px; height: 7px; border-radius: 50%; background: #b46b25; }
.fk-btn { border: 1px solid #d7e1f0; border-radius: 7px; padding: 7px 11px; color: #263b58; background: #fff; }
.fk-btn:hover:not(:disabled) { background: #f0f5ff; }
.fk-btn.fk-primary { background: #285ac4; color: #fff; border-color: #285ac4; }
.fk-btn.fk-primary:hover:not(:disabled) { background: #214eae; }
.fk-btn.fk-remove { color: #a24239; }
.fk-grid { display: grid; gap: 14px; }
.fk-grid.fk-editing { grid-template-columns: minmax(0, 1.45fr) minmax(290px, 1fr); align-items: start; }
.fk-panel, .fk-confirm { background: #fff; border: 1px solid #dce5f0; border-radius: 12px; min-width: 0; }
.fk-list-head, .fk-form, .fk-confirm { padding: 16px; }
.fk-panel h2 { font-size: 17px; font-weight: 700; margin: 0; }
.fk-panel p, .fk-form small { color: #536782; margin: 3px 0 0; font-size: 12px; }
.fk-row { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 10px; align-items: center; border-top: 1px solid #e9eef5; padding: 12px 16px; }
.fk-kind { display: grid; place-items: center; width: 34px; height: 34px; background: #e4edff; color: #315caf; border-radius: 8px; }
.fk-kind.fk-video { background: #e4f4ef; color: #237557; font-size: 12px; }
.fk-item { overflow-wrap: anywhere; }
.fk-item strong { font-weight: 650; }
.fk-item small { color: #526781; font-size: 11px; }
.fk-input { min-width: 0; border: 1px solid #d7e1f0; border-radius: 7px; background: #fff; color: #182942; padding: 7px 9px; font: inherit; }
.fk-input:focus-visible, .fk-admin button:focus-visible { outline: 2px solid #557cc9; outline-offset: 1px; }
.fk-form { display: grid; gap: 10px; }
.fk-form label { display: grid; gap: 4px; color: #30435f; font-size: 13px; }
.fk-form label textarea { resize: vertical; }
.fk-form .fk-actions { justify-content: flex-end; margin-top: 4px; }
.fk-message { border-radius: 8px; background: #e8f5ee; color: #246142; margin-bottom: 12px; padding: 10px 13px; overflow-wrap: anywhere; }
.fk-message.fk-error { background: #fff0ed; color: #9a392f; }
.fk-panel .fk-empty { padding: 24px 16px; text-align: center; }
.fk-confirm { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
.fk-confirm .fk-actions { margin-left: auto; }
.fk-progress { display: flex; gap: 8px; align-items: center; font-size: 12px; }
.fk-progress progress { flex: 1; accent-color: #285ac4; }
@media (max-width: 900px) { .fk-grid.fk-editing { grid-template-columns: 1fr; } .fk-form { grid-row: 1; } }
@media (max-width: 540px) { .fk-admin { padding: 12px; } .fk-hero { align-items: flex-start; flex-direction: column; } .fk-row-actions { grid-column: 2; } }
`;
