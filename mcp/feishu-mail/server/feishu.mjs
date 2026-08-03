// 飞书 OAuth 授权码流 + 邮件 REST 封装。node 原生 fetch(node>=18)，零第三方 HTTP 依赖。
//
// ⚠️ P2 真机核对项(端点/参数以飞书开放平台文档 + 应用实际获批 scope 为准)：
//   - authorize / token 端点与参数命名(client_id vs app_id)
//   - mail user_mailbox folders/messages REST 路径与分页字段
//   - 邮件读取所需 scope 字符串
// 现按飞书 OAuth v2 + mail v1 的通行约定实现，联调时集中在本文件微调。

import { promises as fs } from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";

const AUTH_BASE = process.env.LARK_DOMAIN || "https://open.feishu.cn";
const ACCOUNTS_BASE = process.env.LARK_ACCOUNTS || "https://accounts.feishu.cn";
const AUTHORIZE_URL = `${ACCOUNTS_BASE}/open-apis/authen/v1/authorize`;
const TOKEN_URL = `${AUTH_BASE}/open-apis/authen/v2/oauth/token`;
// 读用户邮箱所需 scope。实测:飞书空 scope 只给「获取用户身份标识」一项,
// 不会按应用已授权限默认全给 —— 故读邮箱必须逐个显式请求 mail scope。
// ⚠️ `mail:user_mailbox:readonly` 是「查询用户企业邮箱(元信息)」,不读邮件正文;
//    读邮件真正需要下面三个(飞书后台均为「用户身份 + 已开通」):
//      mail:user_mailbox.message:readonly       查询用户邮件(列表/详情)
//      mail:user_mailbox.message.body:read      获取邮件正文
//      mail:user_mailbox.message.subject:read   获取邮件主题
// 多条空格分隔;可用 FEISHU_MAIL_SCOPE 覆盖。
// 2026-07-28 扩:飞书后台已开通的其余邮箱权限一并请求 —— 修改邮件(标已读/打标签/移文件夹)、
// 邮箱联系人、收信规则、邮箱元信息、发信。⚠️ 加 scope 后老 token 不含新权限,用户须重新授权一次。
const MAIL_SCOPE = process.env.FEISHU_MAIL_SCOPE || [
  "mail:user_mailbox.message:readonly",
  "mail:user_mailbox.message.body:read",
  "mail:user_mailbox.message.subject:read",
  "mail:user_mailbox.message:modify",
  "mail:user_mailbox.mail_contact:read",
  "mail:user_mailbox.rule:read",
  "mail:user_mailbox:readonly",
  "mail:user_mailbox.message:send",   // 发送/回复/转发(2026-07-28 后台已开通)
  // 2026-08-03 补:列邮件必须给 folder_id 或 label_id,而多数邮箱没有自定义标签
  // (实测 labels 返回空),等于**列文件夹是读邮件的唯一入口**,漏了它整条读取链走不通。
  "mail:user_mailbox.folder:read",
  // 2026-08-03 补:收发件人是飞书的**字段级敏感权限**,不开这条 get/batch_get 就静默不返回
  // head_from/to/cc/reply_to(SDK 类型里有、响应里没有),reply/forward 因此取不到回信地址。
  "mail:user_mailbox.message.address:read",
  // 飞书 v2 OAuth 不给 offline_access 就**不下发 refresh_token**,token 2h 过期后
  // getAccessToken 的刷新分支永远走不到 → 表现为"每两小时就得重新登录一次"。
  "offline_access",
].join(" ");
// 回调地址:飞书按白名单精确匹配、不放宽 loopback 端口,故用**固定**地址(非随机端口),
// 且必须与飞书开放平台「安全设置 → 重定向 URL」登记的完全一致。可用 env 覆盖以对齐后台登记值。
const REDIRECT_URI = process.env.FEISHU_REDIRECT_URI || "http://127.0.0.1:53170/callback";
const _redir = new URL(REDIRECT_URI);
const REDIRECT_HOST = _redir.hostname;                       // 127.0.0.1
const REDIRECT_PORT = Number(_redir.port) || 80;             // 53170

function appCreds() {
  const id = process.env.LARK_APP_ID || "";
  const secret = process.env.LARK_APP_SECRET || "";
  if (!id || !secret) throw new Error("缺少 LARK_APP_ID / LARK_APP_SECRET(应由 felag-server 注入包内 .env)");
  return { id, secret };
}

function tokenPath() {
  const dir = process.env.FEISHU_AUTH_DIR;
  if (!dir) throw new Error("缺少 FEISHU_AUTH_DIR(应由 client 注入)");
  return path.join(dir, "token.json");
}

async function readToken() {
  try {
    return JSON.parse(await fs.readFile(tokenPath(), "utf8"));
  } catch {
    return null;
  }
}

async function writeToken(tok) {
  const p = tokenPath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(tok, null, 2), { mode: 0o600 });
}

function openBrowser(url) {
  // Windows: 用 rundll32 FileProtocolHandler,URL 作单一参数直交默认浏览器。
  // ⚠️ 绝不用 `cmd /c start`:cmd 把 URL 里的 `&` 当命令分隔符,授权链接的
  //   ?client_id=..&redirect_uri=..&state=.. 会被从第一个 & 截断,飞书只收到
  //   client_id、丢了 redirect_uri → 20029。rundll32 不过 cmd 二次解析,& 安全。
  if (process.platform === "win32") {
    spawn("rundll32", ["url.dll,FileProtocolHandler", url], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  }
}

// 授权码换 token。
async function exchangeCode(code, redirectUri) {
  const { id, secret } = appCreds();
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: id,
      client_secret: secret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const j = await resp.json();
  if (!resp.ok || j.code) throw new Error(`换 token 失败: ${JSON.stringify(j)}`);
  return normalizeToken(j);
}

async function refresh(tok) {
  const { id, secret } = appCreds();
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: id,
      client_secret: secret,
      refresh_token: tok.refresh_token,
    }),
  });
  const j = await resp.json();
  if (!resp.ok || j.code) throw new Error(`refresh 失败: ${JSON.stringify(j)}`);
  return normalizeToken(j);
}

function normalizeToken(j) {
  // 飞书 v2 返回 access_token/refresh_token/expires_in(秒)。
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: now + (j.expires_in || 7200) - 120, // 提前 2 分钟视为过期
  };
}

// 拿一个有效 access_token：读缓存 → 近过期则 refresh → 落盘。无缓存/refresh 失败抛 AuthError。
export class AuthError extends Error {}

export async function getAccessToken() {
  const tok = await readToken();
  if (!tok || !tok.access_token) throw new AuthError("未登录飞书");
  const now = Math.floor(Date.now() / 1000);
  if (tok.expires_at && tok.expires_at > now) return tok.access_token;
  if (!tok.refresh_token) throw new AuthError("飞书登录已过期，需重新登录");
  try {
    const fresh = await refresh(tok);
    await writeToken(fresh);
    return fresh.access_token;
  } catch (e) {
    throw new AuthError("飞书登录已过期且刷新失败，需重新登录：" + e.message);
  }
}

// ── 登录：起本地回调 → 开浏览器 → 收 code → 换 token → 落盘 ──
export async function login({ timeoutMs = 120000 } = {}) {
  const { id } = appCreds();
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const u = new URL(req.url, "http://127.0.0.1");
        if (!u.pathname.startsWith("/callback")) {
          res.writeHead(404).end();
          return;
        }
        const err = u.searchParams.get("error");
        const code = u.searchParams.get("code");
        const gotState = u.searchParams.get("state");
        // Connection: close —— 关键:否则浏览器 keep-alive 连接挂住 server.close(),
        // 事件循环不空,login 子进程写完 token 也不退出 → client 按钮永远"登录中"。
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Connection": "close" });
        if (err || !code || gotState !== state) {
          res.end(page(false, "授权失败，请回到应用重试。"));
          cleanup();
          reject(new Error("授权失败: " + (err || "code/state 缺失或不匹配")));
          return;
        }
        const tok = await exchangeCode(code, REDIRECT_URI);
        await writeToken(tok);
        res.end(page(true, "飞书登录成功，本页可关闭。"));
        cleanup();
        resolve({ ok: true });
      } catch (e) {
        try { res.end(page(false, "出错：" + e.message)); } catch {}
        cleanup();
        reject(e);
      }
    });
    const timer = setTimeout(() => { cleanup(); reject(new Error("登录超时")); }, timeoutMs);
    function cleanup() { clearTimeout(timer); try { server.close(); } catch {} }
    server.on("error", (e) => {
      cleanup();
      reject(new Error(`本地回调端口 ${REDIRECT_PORT} 启动失败(${e.code})；换 FEISHU_REDIRECT_URI 端口并同步改飞书后台登记`));
    });
    server.listen(REDIRECT_PORT, REDIRECT_HOST, () => {
      const p = new URLSearchParams({
        client_id: id,
        redirect_uri: REDIRECT_URI,   // 必须与飞书后台「重定向 URL」登记值完全一致
        response_type: "code",
        state,
      });
      if (MAIL_SCOPE) p.set("scope", MAIL_SCOPE);
      openBrowser(`${AUTHORIZE_URL}?${p.toString()}`);
    });
  });
}

function page(ok, msg) {
  const color = ok ? "#1D9E75" : "#F43F5E";
  return `<!doctype html><meta charset="utf-8"><title>飞书授权</title>` +
    `<div style="font:15px/1.6 -apple-system,Segoe UI,sans-serif;padding:48px;max-width:480px;margin:0 auto">` +
    `<div style="border-left:3px solid ${color};padding:1rem 1.4rem;background:#fff">` +
    `<h1 style="font-size:1.1rem;color:${color};margin:.2rem 0">${ok ? "✓ 完成" : "✕ 失败"}</h1>` +
    `<p>${msg}</p></div></div>`;
}

// ── 邮件 REST(user_mailbox_id 用 "me") ──
const MAIL_BASE = `${AUTH_BASE}/open-apis/mail/v1/user_mailboxes/me`;

async function mailReq(pathAndQuery, token, { method = "GET", body } = {}) {
  const init = { method, headers: { Authorization: `Bearer ${token}` } };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json; charset=utf-8";
    init.body = JSON.stringify(body);
  }
  const resp = await fetch(`${MAIL_BASE}${pathAndQuery}`, init);
  const j = await resp.json();
  // 99991668 = token 本身无效/过期;99991679 = token 有效但**缺某条 scope**。
  // ⚠️ 两者必须分开报:曾把 99991679 也说成"token 无效需重新登录",而飞书的 msg 里
  //    已写明缺哪条权限 —— 吞掉它会让人(和 AI)反复重新登录却永远好不了。
  if (j.code === 99991668) {
    throw new AuthError("飞书 user token 无效或已过期，需重新登录");
  }
  if (j.code === 99991679 || j.code === 99991672 || j.code === 99991644) {
    const need = [...new Set((j.msg || "").match(/mail:[A-Za-z_.:]+/g) || [])];
    throw new AuthError(
      need.length
        ? `飞书授权缺少权限 [${need.join(", ")}] —— 重新登录只在该权限已于飞书开放平台开通并发布版本后才有用；否则请先去后台开通。`
        : `飞书授权缺少该能力所需权限：${j.msg || ""}`
    );
  }
  if (!resp.ok || (j.code && j.code !== 0)) {
    throw new Error(`飞书接口错误: ${JSON.stringify(j)}`);
  }
  return j.data;
}

const mailGet = (pathAndQuery, token) => mailReq(pathAndQuery, token);

export async function listFolders() {
  const token = await getAccessToken();
  return await mailGet(`/folders`, token);
}

// 列邮件。飞书要求 folder_id 与 label_id 必给其一(否则报 "must pass either folder_id or label_id");
// page_size 上限 20(传更大直接报错)。only_unread 由接口原生支持,不必逐封读 label_ids 自己筛。
export async function listMessages({ folder_id, label_id, page_token, page_size = 20, only_unread }) {
  const token = await getAccessToken();
  const q = new URLSearchParams();
  if (folder_id) q.set("folder_id", folder_id);
  if (label_id) q.set("label_id", label_id);
  if (page_token) q.set("page_token", page_token);
  if (only_unread) q.set("only_unread", "true");
  q.set("page_size", String(Math.min(page_size || 20, 20)));
  return await mailGet(`/messages?${q.toString()}`, token);
}

// 时间口径统一。飞书两条路径给两种格式:list/get/batch_get 给 `internal_date`(epoch 毫秒
// 字符串),search 给 `meta_data.create_time`(ISO 8601)。两者无法直接比对,故凡是带
// internal_date 的返回都**补**一个 ISO 的 `create_time`(不动原字段,保持向后兼容)。
function withIsoTime(m) {
  if (!m || typeof m !== "object" || m.create_time || !m.internal_date) return m;
  const ms = Number(m.internal_date);
  if (!Number.isFinite(ms)) return m;
  return { ...m, create_time: new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z") };
}

// 原邮件能否回复。⚠️ 飞书 get/batch_get **不返回** head_from/to/cc(SDK 类型里有、实际响应
// 里没有,应为字段级 scope 未开通),所以这里多数情况只能判成 false —— 这不是"该邮件不可回复",
// 而是"本 token 读不到发件人"。reply_message 因此支持显式传 to 绕过。
function withReplyable(m) {
  if (!m || typeof m !== "object") return m;
  const addr = m.reply_to || m.head_from?.mail_address || "";
  return {
    ...m,
    replyable: Boolean(addr),
    ...(addr ? {} : { replyable_hint: "本次返回不含发件人地址(飞书未下发 head_from/reply_to)，回复请用 search_messages 取 meta_data.from.mail_address 后显式传 to" }),
  };
}

export async function getMessage({ message_id }) {
  const token = await getAccessToken();
  const d = await mailGet(`/messages/${encodeURIComponent(message_id)}`, token);
  if (d?.message) d.message = withReplyable(withIsoTime(d.message));
  return d;
}

// 批量取详情:一次最多给一批 message_id,省掉逐封 get 的往返。
// format: full(默认,含 html) / plain_text_full(纯文本正文) / metadata(只要头部,最省)。
export async function getMessages({ message_ids, format = "plain_text_full" }) {
  const token = await getAccessToken();
  const d = await mailReq(`/messages/batch_get`, token, {
    method: "POST",
    body: { message_ids, format },
  });
  if (Array.isArray(d?.messages)) d.messages = d.messages.map((m) => withReplyable(withIsoTime(m)));
  return d;
}

// search 的 page_size **实测上限 15**(16 起报 1231021 page size is over the limit),
// 与 list_messages 的 20 不同,别照抄。
const SEARCH_PAGE_MAX = 15;

// filter.create_time 只认 ISO 8601("2026-05-01T00:00:00Z");传 epoch 毫秒/秒会被飞书
// 以 99992402 field validation failed 拒掉。调用方(AI)极易传毫秒,故这里**兼容转换**。
function toIsoTime(v) {
  if (v == null || v === "") return v;
  const s = String(v).trim();
  if (!/^\d+$/.test(s)) return s;                       // 已是 ISO,原样过
  const n = Number(s);
  const ms = s.length <= 10 ? n * 1000 : n;             // 10 位=秒,13 位=毫秒
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? s : d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// 搜索邮件(POST /search)。query 是全文关键词;filter 支持发件人/收件人/主题/文件夹/标签/
// 是否有附件/是否未读/时间区间。比逐页翻 + 逐封读快一个数量级。
// ⚠️ 结果**恒按时间倒序**,飞书不提供排序参数(sort_order/order_by/sort_type 实测均被静默
//    忽略)。要找最早的邮件,用 filter.create_time 开窗二分,别指望翻到最后一页。
export async function searchMessages({ query, filter, page_token, page_size = SEARCH_PAGE_MAX }) {
  const token = await getAccessToken();
  const q = new URLSearchParams();
  if (page_token) q.set("page_token", page_token);
  q.set("page_size", String(Math.min(page_size || SEARCH_PAGE_MAX, SEARCH_PAGE_MAX)));
  const body = {};
  if (query) body.query = query;
  if (filter && Object.keys(filter).length) {
    const f = { ...filter };
    if (f.create_time) {
      f.create_time = {
        ...(f.create_time.start_time ? { start_time: toIsoTime(f.create_time.start_time) } : {}),
        ...(f.create_time.end_time ? { end_time: toIsoTime(f.create_time.end_time) } : {}),
      };
    }
    body.filter = f;
  }
  const d = await mailReq(`/search?${q.toString()}`, token, { method: "POST", body });
  // 原始结果每条是 {id, display_info, meta_data},display_info 是塞了 <h> 高亮标记的
  // 拼接文本 —— 对模型是噪音。把 meta_data 提到顶层给出规整字段,原字段保留不删。
  if (Array.isArray(d?.items)) {
    d.items = d.items.map((it) => {
      const md = it.meta_data || {};
      return {
        ...it,
        message_id: it.id,
        subject: md.subject,
        from: md.from,
        create_time: md.create_time,          // 已是 ISO 8601,与补齐后的 get 口径一致
      };
    });
  }
  return d;
}

// 取附件下载链接。⚠️ 飞书限制:每个链接只能用两次、有效期两小时,不要缓存转发。
export async function attachmentLinks({ message_id, attachment_ids }) {
  const token = await getAccessToken();
  const q = new URLSearchParams();
  for (const id of attachment_ids) q.append("attachment_ids", id);
  return await mailGet(
    `/messages/${encodeURIComponent(message_id)}/attachments/download_url?${q.toString()}`, token);
}

// 修改邮件:加/减标签(标已读 = 移除 UNREAD)、移动到文件夹。唯一的写操作。
export async function modifyMessage({ message_id, add_label_ids, remove_label_ids, add_folder }) {
  const token = await getAccessToken();
  const body = {};
  if (add_label_ids?.length) body.add_label_ids = add_label_ids;
  if (remove_label_ids?.length) body.remove_label_ids = remove_label_ids;
  if (add_folder) body.add_folder = add_folder;
  if (!Object.keys(body).length) throw new Error("modify 至少要给一项:add_label_ids/remove_label_ids/add_folder");
  return await mailReq(`/messages/${encodeURIComponent(message_id)}/modify`, token, {
    method: "POST",
    body,
  });
}

export async function listLabels() {
  const token = await getAccessToken();
  return await mailGet(`/labels`, token);
}

export async function listContacts({ page_token, page_size = 20 } = {}) {
  const token = await getAccessToken();
  const q = new URLSearchParams();
  if (page_token) q.set("page_token", page_token);
  q.set("page_size", String(Math.min(page_size || 20, 20)));
  return await mailGet(`/mail_contacts?${q.toString()}`, token);
}

export async function listRules() {
  const token = await getAccessToken();
  return await mailGet(`/rules`, token);
}

// 自己的邮箱主地址(回复全部时用来把自己从抄送里剔掉)。取一次缓存在进程内。
let _selfAddr;
async function selfAddress() {
  if (_selfAddr !== undefined) return _selfAddr;
  try {
    const token = await getAccessToken();
    const d = await mailGet(`/profile`, token);
    _selfAddr = (d?.primary_email_address || "").toLowerCase();
  } catch {
    _selfAddr = ""; // 取不到不影响发信,只是可能抄送到自己
  }
  return _selfAddr;
}

// ── 发信(需 mail:user_mailbox.message:send) ──
// ⚠️ 用飞书 send 的结构化字段(subject/to/body_*),不走 raw RFC822 —— 因此**不携带
// In-Reply-To/References 头**,回复在对方客户端里靠主题聚合、不保证串进原邮件线程。
// 要严格串线程需改用 raw(base64url 的完整 RFC822),届时得自己做 MIME 编码。
export async function sendMessage({ to, cc, bcc, subject, body_plain_text, body_html, dedupe_key }) {
  const token = await getAccessToken();
  if (!to?.length) throw new Error("缺收件人 to");
  if (!body_plain_text && !body_html) throw new Error("缺正文(body_plain_text 或 body_html)");
  const body = { to: addrList(to), subject: subject || "" };
  if (cc?.length) body.cc = addrList(cc);
  if (bcc?.length) body.bcc = addrList(bcc);
  if (body_plain_text) body.body_plain_text = body_plain_text;
  if (body_html) body.body_html = body_html;
  if (dedupe_key) body.dedupe_key = dedupe_key;
  return await mailReq(`/messages/send`, token, { method: "POST", body });
}

// 收件人既接受 "a@b.com" 也接受 {mail_address,name}
function addrList(list) {
  return list.map((x) => (typeof x === "string" ? { mail_address: x } : x));
}

function quoteBlock(m) {
  const from = m.head_from ? `${m.head_from.name || ""} <${m.head_from.mail_address}>` : "(未知)";
  const when = m.internal_date ? new Date(Number(m.internal_date)).toLocaleString("zh-CN") : "";
  const to = (m.to || []).map((a) => a.mail_address).join(", ");
  return `\n\n------------------ 原始邮件 ------------------\n` +
    `发件人: ${from}\n时间: ${when}\n收件人: ${to}\n主题: ${m.subject || ""}\n\n` +
    (m.body_plain_text || m.body_preview || "(原文正文不可用)");
}

// 回复:读原件 → 收件人取原发件人(有 reply_to 优先) → 主题补 Re: → 正文附引用块。
// reply_all=true 时把原 to/cc 一并抄送(已剔除自己)。
export async function replyMessage({ message_id, body_plain_text, reply_all = false, extra_to = [], to: explicitTo }) {
  if (!body_plain_text) throw new Error("缺回复正文 body_plain_text");
  const d = await getMessage({ message_id });
  const m = d?.message || d;
  if (!m) throw new Error("原邮件不存在");
  // 优先用调用方显式给的地址:飞书 get/batch_get 多数情况不下发 head_from/reply_to,
  // 没有它并不代表"这封邮件不能回复"(旧版就是这么误报的)。
  const replyTo = explicitTo || m.reply_to || m.head_from?.mail_address;
  if (!replyTo) {
    throw new Error(
      "取不到原邮件的发件人地址：飞书 get/batch_get 未下发 head_from/reply_to(字段级权限未开通)。" +
      "请用 search_messages 找到该邮件、取 meta_data.from.mail_address，再把它作为 to 参数显式传入 reply_message。"
    );
  }
  const to = [replyTo, ...extra_to];
  let cc = [];
  if (reply_all) {
    const me = await selfAddress();
    cc = [...(m.to || []), ...(m.cc || [])]
      .map((a) => a.mail_address)
      .filter((a) => a && a.toLowerCase() !== me && a.toLowerCase() !== replyTo.toLowerCase());
    cc = [...new Set(cc)];
  }
  const subject = /^re:/i.test(m.subject || "") ? m.subject : `Re: ${m.subject || ""}`;
  return await sendMessage({
    to, cc, subject,
    body_plain_text: body_plain_text + quoteBlock(m),
  });
}

// 转发:读原件 → 主题补 Fwd: → 正文附原文引用块。⚠️ 不带原附件(飞书 send 要求把附件内容
// base64 重新上传,本工具不做);要转附件请用 get_attachment_links 把链接给收件人。
export async function forwardMessage({ message_id, to, cc, body_plain_text = "" }) {
  if (!to?.length) throw new Error("缺收件人 to");
  const d = await getMessage({ message_id });
  const m = d?.message || d;
  if (!m) throw new Error("原邮件不存在");
  const subject = /^fwd?:/i.test(m.subject || "") ? m.subject : `Fwd: ${m.subject || ""}`;
  const note = (m.attachments || []).length
    ? `\n(原邮件有 ${m.attachments.length} 个附件，未随本次转发)`
    : "";
  return await sendMessage({
    to, cc, subject,
    body_plain_text: (body_plain_text || "") + note + quoteBlock(m),
  });
}

export async function status() {
  const tok = await readToken();
  if (!tok || !tok.access_token) return { loggedIn: false };
  const now = Math.floor(Date.now() / 1000);
  return { loggedIn: true, expired: !(tok.expires_at > now), expires_at: tok.expires_at };
}
