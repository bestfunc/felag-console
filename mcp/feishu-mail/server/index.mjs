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
      description:
        "按文件夹/标签列出邮件 id。⚠️ folder_id 与 label_id 必须给其一" +
        "(都不给会报 must pass either folder_id or label_id)；page_size 上限 20；" +
        "翻页把返回的 page_token 回传。只要未读用 only_unread=true，别逐封读 label_ids 自己筛。" +
        "⚠️ 本接口**没有时间过滤、也不能反向排序**(飞书未提供，传 start_time/sort_order 之类会被静默忽略)。" +
        "要按时间范围找邮件、或找某个月份/最早的邮件，一律改用 search_messages 的 filter.create_time 开窗，" +
        "**不要在这里一页页翻**。",
      inputSchema: {
        folder_id: z.string().optional().describe("文件夹 id(来自 list_folders)；与 label_id 二选一"),
        label_id: z.string().optional().describe("标签 id(来自 list_labels)；与 folder_id 二选一"),
        only_unread: z.boolean().optional().describe("只列未读"),
        page_token: z.string().optional().describe("翻页标记(上次返回的 page_token)"),
        page_size: z.number().int().min(1).max(20).optional().describe("每页条数，上限 20，默认 20"),
      },
    },
    async (args) => call(() => feishu.listMessages(args || {}))
  );

  server.registerTool(
    "search_messages",
    {
      title: "搜索飞书邮件",
      description:
        "按关键词/条件搜索邮件，替代逐页翻找。query 是全文关键词；filter 可按发件人、收件人、" +
        "主题、文件夹、标签、是否带附件、是否未读、时间区间筛。**page_size 上限 15**(与 list_messages 的 20 不同)。" +
        "返回每条含 message_id / subject / from / create_time(ISO 8601)。" +
        "⚠️ 结果**恒按时间倒序**，飞书不提供排序参数。要找最早的邮件，用 filter.create_time 开窗二分" +
        "(先试一个宽窗，有结果就往早的一半收窄)，别翻到最后一页。" +
        "⚠️ 只有本工具能拿到发件人地址(meta_data.from)，get_message 拿不到 —— 要回复某封邮件，" +
        "先用它取 from.mail_address，再显式传给 reply_message 的 to。",
      inputSchema: {
        query: z.string().optional().describe("全文关键词，如 “报价 IBC”"),
        filter: z
          .object({
            from: z.array(z.string()).optional().describe("发件人邮箱"),
            to: z.array(z.string()).optional().describe("收件人邮箱"),
            cc: z.array(z.string()).optional(),
            bcc: z.array(z.string()).optional(),
            subject: z.string().optional().describe("主题包含"),
            folder: z.array(z.string()).optional().describe("限定文件夹 id"),
            label: z.array(z.string()).optional().describe("限定标签 id"),
            has_attachment: z.boolean().optional(),
            is_unread: z.boolean().optional(),
            create_time: z
              .object({ start_time: z.string().optional(), end_time: z.string().optional() })
              .optional()
              .describe('时间区间，ISO 8601 字符串，如 "2026-05-01T00:00:00Z"(传毫秒时间戳会自动转换，但请直接给 ISO)'),
          })
          .optional(),
        page_token: z.string().optional(),
        page_size: z.number().int().min(1).max(15).optional().describe("上限 15(实测 16 即报错)，默认 15"),
      },
    },
    async (args) => call(() => feishu.searchMessages(args || {}))
  );

  server.registerTool(
    "get_message",
    {
      title: "读取飞书邮件全文",
      description:
        "按 message_id 读取单封邮件完整内容(正文/附件列表/时间)。要读多封请用 get_messages 批量取。" +
        "返回补了 create_time(ISO 8601，由 internal_date 换算，便于与 search_messages 对比)。" +
        "⚠️ 收发件人地址属飞书「敏感字段」，未开通「获取邮件内容中地址相关字段」权限时**不会返回**；" +
        "此时返回里 replyable=false，要回复请用 search_messages 取 meta_data.from.mail_address。",
      inputSchema: {
        message_id: z.string().describe("邮件 id(来自 list_messages / search_messages)"),
      },
    },
    async (args) => call(() => feishu.getMessage(args))
  );

  server.registerTool(
    "get_messages",
    {
      title: "批量读取飞书邮件",
      description:
        "一次读多封邮件详情，省掉逐封往返。format: plain_text_full(默认，纯文本正文) / full(含 html) / " +
        "metadata(只要头部，最省 token)。总结一批邮件时优先用它 + metadata 先扫再定点细读。",
      inputSchema: {
        message_ids: z.array(z.string()).min(1).describe("邮件 id 列表"),
        format: z.enum(["plain_text_full", "full", "metadata"]).optional(),
      },
    },
    async (args) => call(() => feishu.getMessages(args))
  );

  server.registerTool(
    "get_attachment_links",
    {
      title: "取飞书邮件附件下载链接",
      description:
        "按 attachment_id 换取附件下载直链(附件 id 来自 get_message 的附件列表)。" +
        "⚠️ 飞书限制:每条链接只能用两次、有效期 2 小时。工具本身不下载文件，拿到链接后用能下载的工具或交给用户。",
      inputSchema: {
        message_id: z.string().describe("邮件 id"),
        attachment_ids: z.array(z.string()).min(1).describe("附件 id 列表(来自 get_message)"),
      },
    },
    async (args) => call(() => feishu.attachmentLinks(args))
  );

  server.registerTool(
    "list_labels",
    {
      title: "列出飞书邮箱标签",
      description: "列出邮件标签(id/名称/颜色/未读数)。label_id 可喂给 list_messages 或 modify_message。",
      inputSchema: {},
    },
    async () => call(() => feishu.listLabels())
  );

  server.registerTool(
    "modify_message",
    {
      title: "修改飞书邮件标签/归档",
      description:
        "本插件唯一的写操作:给邮件加/减标签、移动到文件夹。标记已读 = remove_label_ids:[\"UNREAD\"]，" +
        "标为未读 = add_label_ids:[\"UNREAD\"]。不能删除邮件、不能发信。执行前先向用户说明要改哪封。",
      inputSchema: {
        message_id: z.string().describe("邮件 id"),
        add_label_ids: z.array(z.string()).optional().describe("要加的标签 id"),
        remove_label_ids: z.array(z.string()).optional().describe("要移除的标签 id"),
        add_folder: z.string().optional().describe("移动到的文件夹 id"),
      },
    },
    async (args) => call(() => feishu.modifyMessage(args))
  );

  server.registerTool(
    "list_contacts",
    {
      title: "列出飞书邮箱联系人",
      description: "列出邮箱联系人(姓名/邮箱)。page_size 上限 20，翻页用 page_token。",
      inputSchema: {
        page_token: z.string().optional(),
        page_size: z.number().int().min(1).max(20).optional(),
      },
    },
    async (args) => call(() => feishu.listContacts(args || {}))
  );

  server.registerTool(
    "list_rules",
    {
      title: "列出飞书邮箱收信规则",
      description: "列出收信规则(自动归档/打标签等)。只读，不改规则。",
      inputSchema: {},
    },
    async () => call(() => feishu.listRules())
  );

  // ── 发信类(不可逆、对外可见)。工具描述里强制"先给用户看草稿再发",
  //    因为 MCP 工具在客户端侧不弹审批,这层提示是发出去之前唯一的闸。
  server.registerTool(
    "send_message",
    {
      title: "发送飞书邮件",
      description:
        "以当前登录用户身份发一封新邮件。⚠️ 不可逆、对外可见:**必须先把收件人/主题/正文完整念给用户、" +
        "得到明确同意后再调用**，不要自己拟完就发。同一封别重复调用(可传 dedupe_key 兜底)。",
      inputSchema: {
        to: z.array(z.string()).min(1).describe("收件人邮箱地址"),
        subject: z.string().describe("主题"),
        body_plain_text: z.string().optional().describe("纯文本正文(优先用这个)"),
        body_html: z.string().optional().describe("html 正文(需要排版时才用)"),
        cc: z.array(z.string()).optional(),
        bcc: z.array(z.string()).optional(),
        dedupe_key: z.string().optional().describe("幂等键，防重复发送"),
      },
    },
    async (args) => call(() => feishu.sendMessage(args))
  );

  server.registerTool(
    "reply_message",
    {
      title: "回复飞书邮件",
      description:
        "回复某封邮件:主题补 Re:、正文后附原文引用。收件人优先用你传的 to；不传则尝试取原发件人。" +
        "reply_all=true 时把原收件人/抄送一并抄送(已剔除自己)。" +
        "⚠️ 不可逆:**先把回复正文念给用户确认再调用**。" +
        "⚠️ 若报「取不到原邮件的发件人地址」，不是这封邮件不能回复 —— 是飞书未下发地址字段。" +
        "改用 search_messages 找到该邮件、取 meta_data.from.mail_address，作为 to 传进来即可。" +
        "注意:本工具不携带 In-Reply-To 头，回复靠主题聚合、不保证串进原会话线程。",
      inputSchema: {
        message_id: z.string().describe("被回复的邮件 id"),
        body_plain_text: z.string().describe("你要回复的正文(引用块会自动附在后面)"),
        to: z.string().optional().describe("收件人地址；原邮件取不到发件人时必传(来自 search_messages 的 meta_data.from.mail_address)"),
        reply_all: z.boolean().optional().describe("是否回复全部，默认 false"),
        extra_to: z.array(z.string()).optional().describe("额外收件人"),
      },
    },
    async (args) => call(() => feishu.replyMessage(args))
  );

  server.registerTool(
    "forward_message",
    {
      title: "转发飞书邮件",
      description:
        "把某封邮件转发给指定收件人:主题补 Fwd:、正文附原文。" +
        "⚠️ 不可逆:**先告诉用户要把哪封转给谁、得到同意再调用**。" +
        "⚠️ 不携带原附件(飞书要求重新上传附件内容)；要给对方附件请用 get_attachment_links 取链接附在正文里。",
      inputSchema: {
        message_id: z.string().describe("要转发的邮件 id"),
        to: z.array(z.string()).min(1).describe("收件人邮箱地址"),
        cc: z.array(z.string()).optional(),
        body_plain_text: z.string().optional().describe("转发时想附的说明(可空)"),
      },
    },
    async (args) => call(() => feishu.forwardMessage(args))
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
