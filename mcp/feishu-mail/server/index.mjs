#!/usr/bin/env node
// 精简飞书邮件 MCP 入口。三模式:
//   node index.mjs serve   —— 启动 stdio MCP 服务(数字员工对话时由 Agent SDK 拉起)
//   node index.mjs login    —— 开浏览器做飞书 OAuth，拿 user_access_token 存本地(client 亲自 spawn)
//   node index.mjs status   —— 打印 {"loggedIn":bool}，供 client 判定登录态
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as feishu from "./feishu.mjs";

const mode = process.argv[2] || "serve";

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function fail(msg, isAuth) {
  return {
    isError: true,
    content: [{ type: "text", text: (isAuth ? "[需登录飞书] " : "[错误] ") + msg }],
  };
}
async function call(fn) {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e.message, e instanceof feishu.AuthError);
  }
}

async function serve() {
  const server = new McpServer({ name: "feishu-mail", version: "0.1.0" });

  server.registerTool(
    "list_folders",
    {
      title: "列出飞书邮箱文件夹",
      description: "列出当前用户飞书邮箱的文件夹(收件箱/已发送/自定义等)，返回 folder_id 供后续列邮件。",
      inputSchema: {},
    },
    async () => call(() => feishu.listFolders())
  );

  server.registerTool(
    "list_messages",
    {
      title: "列出飞书邮件",
      description: "列出某文件夹下的邮件摘要(主题/发件人/时间/message_id)。folder_id 省略则列默认文件夹。",
      inputSchema: {
        folder_id: z.string().optional().describe("文件夹 id(来自 list_folders)"),
        page_token: z.string().optional().describe("分页标记"),
        page_size: z.number().int().min(1).max(50).optional().describe("每页条数，默认 20"),
      },
    },
    async (args) => call(() => feishu.listMessages(args || {}))
  );

  server.registerTool(
    "get_message",
    {
      title: "读取飞书邮件全文",
      description: "按 message_id 读取单封邮件完整内容(正文/收发件人/附件列表)。",
      inputSchema: {
        message_id: z.string().describe("邮件 id(来自 list_messages)"),
      },
    },
    async (args) => call(() => feishu.getMessage(args))
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function main() {
  if (mode === "login") {
    await feishu.login();
    // login 成功即退出(信息已在浏览器页展示;token 已同步落盘);失败抛错非零退出。
    process.stderr.write("飞书登录完成。\n");
    // 兜底:若仍有 socket/handle 挂住事件循环,1.5s 后强制退出(unref 不阻止提前正常退出)。
    setTimeout(() => process.exit(0), 1500).unref();
    return;
  }
  if (mode === "status") {
    process.stdout.write(JSON.stringify(await feishu.status()) + "\n");
    return;
  }
  await serve();
}

main().catch((e) => {
  process.stderr.write("feishu-mail MCP 启动失败: " + (e?.stack || e?.message || String(e)) + "\n");
  process.exit(1);
});
