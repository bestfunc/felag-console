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
// 读用户邮箱所需 scope(P2 按应用获批调整)；空则用应用已授全部权限。
const MAIL_SCOPE = process.env.FEISHU_MAIL_SCOPE || "";
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
  // Windows: cmd start;其它平台兜底。login 由 felag 亲自 spawn(可 hideConsole)。
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
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
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
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

async function mailGet(pathAndQuery, token) {
  const resp = await fetch(`${MAIL_BASE}${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = await resp.json();
  // 飞书业务码 99991668/99991679 = user token 无效/未授权
  if (j.code === 99991668 || j.code === 99991679) {
    throw new AuthError("飞书 user token 无效或未授权，需重新登录");
  }
  if (!resp.ok || (j.code && j.code !== 0)) {
    throw new Error(`飞书接口错误: ${JSON.stringify(j)}`);
  }
  return j.data;
}

export async function listFolders() {
  const token = await getAccessToken();
  return await mailGet(`/folders`, token);
}

export async function listMessages({ folder_id, page_token, page_size = 20 }) {
  const token = await getAccessToken();
  const q = new URLSearchParams();
  if (folder_id) q.set("folder_id", folder_id);
  if (page_token) q.set("page_token", page_token);
  q.set("page_size", String(page_size));
  return await mailGet(`/messages?${q.toString()}`, token);
}

export async function getMessage({ message_id }) {
  const token = await getAccessToken();
  return await mailGet(`/messages/${encodeURIComponent(message_id)}`, token);
}

export async function status() {
  const tok = await readToken();
  if (!tok || !tok.access_token) return { loggedIn: false };
  const now = Math.floor(Date.now() / 1000);
  return { loggedIn: true, expired: !(tok.expires_at > now), expires_at: tok.expires_at };
}
