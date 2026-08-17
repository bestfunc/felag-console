#!/usr/bin/env node
// felag-vision —— 图片 / 视频识别 MCP 插件。
//
// 🔒 与 feishu-mail 的本质差别:那个插件持的 LARK 凭据不是 LLM key,可以随签名包下发;
// **识图用的 GLM key 是 LLM key,下发就破 M5**。所以本插件不直连智谱,
// 只持一个访问 felag-server /vision/describe 的服务令牌,上游 key 留在网关:
//
//   数字员工 → 本插件 --服务令牌--> felag-server --master key--> LiteLLM → GLM
//
// 🔒 路径安全:client 对 mcp__* 工具是**自动放行不弹审批**的。不加限制的话,
// 数字员工可以 describe_image("C:/私密文档.png") 把任意文件内容送到外部模型 ——
// 这是一条数据外泄通道。故本地文件只允许读 FELAG_VISION_ROOTS 指定的根(client 注入
// 工作区 + 用户显式拖入的引用);未注入时 fail-closed:只接受 url,不读本地文件。

import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const SERVER_BASE = (process.env.FELAG_SERVER_BASE || "").replace(/\/+$/, "");
const TOKEN = process.env.FELAG_VISION_TOKEN || "";
// 允许读取的根目录,os.pathsep 分隔。client 注入:会话工作区 + 用户拖入的只读引用。
const ROOTS = (process.env.FELAG_VISION_ROOTS || "")
  .split(path.delimiter)
  .map((s) => s.trim())
  .filter(Boolean);

// 体积闸:base64 后约 1.33 倍,服务端限 64MB,这里留足余量。
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 40 * 1024 * 1024;

const MIME = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska", ".webm": "video/webm",
};

function ok(text) {
  return { content: [{ type: "text", text }] };
}
function fail(msg) {
  return { content: [{ type: "text", text: `识别失败:${msg}` }], isError: true };
}

// resolveLocal 把用户给的路径解析成绝对真实路径,并确认它落在允许的根内。
// 用 realpath 归一:否则 workdir 里放一个指向 C:\ 的 symlink/junction 就能绕出去。
function resolveLocal(p) {
  if (!ROOTS.length) {
    throw new Error(
      "本插件未获得可读目录授权,出于安全不读取本地文件。" +
      "请改用 url 参数,或让用户把文件放进工作区/拖入对话后重试。"
    );
  }
  const abs = path.resolve(p);
  let real;
  try {
    real = fs.realpathSync(abs);
  } catch {
    throw new Error(`文件不存在:${p}`);
  }
  for (const root of ROOTS) {
    let rr;
    try {
      rr = fs.realpathSync(path.resolve(root));
    } catch {
      continue;
    }
    if (real === rr || real.startsWith(rr + path.sep)) return real;
  }
  throw new Error(
    `路径不在允许范围内:${p}。只能识别工作区内、或用户已拖入本次对话的文件。`
  );
}

function readAsBase64(file, kind) {
  const limit = kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  const st = fs.statSync(file);
  if (!st.isFile()) throw new Error(`不是文件:${file}`);
  if (st.size > limit) {
    throw new Error(
      `文件过大(${(st.size / 1048576).toFixed(1)}MB,上限 ${limit / 1048576}MB)。` +
      (kind === "video" ? "请先截取片段再试。" : "请先压缩后再试。")
    );
  }
  const mime = MIME[path.extname(file).toLowerCase()] ||
    (kind === "video" ? "video/mp4" : "image/png");
  return { base64: fs.readFileSync(file).toString("base64"), mime };
}

// callServer 把 parts 交给 felag-server,由它转网关。
async function callServer(parts, model, maxTokens) {
  if (!SERVER_BASE) throw new Error("FELAG_SERVER_BASE 未注入(客户端版本过旧?)");
  if (!TOKEN) throw new Error("FELAG_VISION_TOKEN 未注入(服务端未开启识别端点?)");
  // 主动设超时:MCP 工具调用本身有超时(客户端默认 60s),被它掐掉的话模型只会拿到一个
  // 无信息的协议错误。这里提前一步返回可读原因,让它知道是"该等一会儿"而不是"坏了"。
  let resp;
  try {
    resp = await fetch(`${SERVER_BASE}/vision/describe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ parts, model: model || undefined, maxTokens: maxTokens || undefined }),
      signal: AbortSignal.timeout(50_000),
    });
  } catch (e) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      throw new Error(
        "识别超时(上游免费额度同时只处理一个请求,可能正在排队)。请隔十几秒再试一次;" +
        "如果是视频,建议先截取较短的片段。"
      );
    }
    throw new Error(`连接服务端失败:${e.message}`);
  }
  const raw = await resp.text();
  if (!resp.ok) {
    // 服务端把上游限流的原文透出来,这里原样带给模型,让它知道该等而不是重试到死。
    throw new Error(`服务端返回 ${resp.status}: ${raw.slice(0, 300)}`);
  }
  try {
    return JSON.parse(raw).text || "";
  } catch {
    throw new Error("服务端响应解析失败");
  }
}

// buildParts 组装多模态输入:本地文件转 base64、URL 直传,末尾附问题。
function buildParts(kind, { path: p, url, question }) {
  if (!p && !url) throw new Error("必须给 path(本地文件)或 url(公网地址)其一");
  const parts = [];
  if (url) {
    parts.push({ kind, url });
  } else {
    const real = resolveLocal(p);
    const { base64, mime } = readAsBase64(real, kind);
    parts.push({ kind, base64, mime });
  }
  parts.push({
    kind: "text",
    text: question || (kind === "video"
      ? "这段视频讲了什么?用中文简要概括,包含画面中的关键文字与动作。"
      : "描述这张图片的内容。若图中有文字,请一并转录。用中文回答。"),
  });
  return parts;
}

async function serve() {
  const server = new McpServer({ name: "felag-vision", version: "0.1.0" });

  const common = {
    url: z.string().optional().describe("公网可访问的地址;与 path 二选一"),
    question: z.string().optional().describe("想问的具体问题;不给则做通用描述+文字转录"),
    model: z.string().optional().describe(
      "指定识别模型(如 glm-4.6v-flash)。不给则用平台「模型与密钥」页设为「使用中」的识图模型"
    ),
  };

  server.registerTool(
    "describe_image",
    {
      title: "识别图片内容",
      description:
        "看一张图片并用文字描述其内容(含图中文字转录)。" +
        "path 给本地文件路径(**只能是工作区内、或用户已拖入本次对话的文件**)," +
        "url 给公网地址,二选一。" +
        "⚠️ 上游是免费额度:**同时只能处理一张**,多张图请一张张顺序调用,不要并发;" +
        "遇到限流会自动重试,失败时请隔一会儿再试,不要连续重发。",
      inputSchema: {
        path: z.string().optional().describe("本地图片路径;与 url 二选一"),
        ...common,
      },
    },
    async (args) => {
      try {
        return ok(await callServer(buildParts("image", args || {}), args?.model));
      } catch (e) {
        return fail(e.message);
      }
    }
  );

  server.registerTool(
    "describe_video",
    {
      title: "识别视频内容",
      description:
        "看一段视频并用文字概括其内容。path 给本地文件路径(**限工作区内或用户已拖入的文件**)," +
        "url 给公网地址,二选一。" +
        "⚠️ 视频比图片贵得多(单次可达数万 token),且上游同时只能处理一个 —— " +
        "只在用户明确要求理解视频时调用,不要用它来试探。",
      inputSchema: {
        path: z.string().optional().describe("本地视频路径;与 url 二选一"),
        ...common,
      },
    },
    async (args) => {
      try {
        return ok(await callServer(buildParts("video", args || {}), args?.model, 2000));
      } catch (e) {
        return fail(e.message);
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// status:给 client 探测用 —— 报告注入是否齐全,便于在连接器页显示可用性。
function status() {
  const missing = [];
  if (!SERVER_BASE) missing.push("FELAG_SERVER_BASE");
  if (!TOKEN) missing.push("FELAG_VISION_TOKEN");
  const out = {
    ready: missing.length === 0,
    missing,
    readableRoots: ROOTS.length,
    localFilesAllowed: ROOTS.length > 0,
  };
  process.stdout.write(JSON.stringify(out) + "\n");
  process.exit(out.ready ? 0 : 1);
}

const cmd = process.argv[2] || "serve";
if (cmd === "status") status();
else await serve();
