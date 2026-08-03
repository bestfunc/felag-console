# feishu-mail —— 飞书官方邮件插件（Claude Code MCP 插件）

数字员工用的**飞书邮箱**插件。用户在客户端「连接器」页登录飞书后，数字员工可访问其飞书邮箱。

**工具（v0.3.0，13 个）**

- 读：`list_folders` / `list_labels` / `list_messages`（支持 `only_unread`、`label_id`，`page_size` 上限 20）/ `search_messages`（关键词 + from/to/主题/标签/有无附件/未读/时间区间过滤）/ `get_message` / `get_messages`（批量，format=metadata|plain_text_full|full）/ `get_attachment_links`（附件下载直链，**仅可用两次、2 小时有效**）/ `list_contacts` / `list_rules`
- 写：`modify_message`（加减标签、移动文件夹；标已读 = 移除 `UNREAD`）/ `send_message` / `reply_message`（自动带原文引用、主题 Re:）/ `forward_message`（主题 Fwd:）

**发信的已知限制**：走飞书 send 的结构化字段而非 raw RFC822，故**不携带 `In-Reply-To` 头**，回复靠主题聚合、不保证串进原会话线程；**不支持带附件发送 / 转发原附件**（飞书要求把附件内容 base64 重新上传）。

**不支持**：删除邮件、撤回、改规则/联系人。

⚠️ MCP 工具在客户端侧**不弹审批**，发信不可逆 —— 闸门只在 SKILL.md 的「发信规矩」（发前必须把草稿念给用户确认）。要硬约束需在 felag-client 审批层对发信类工具单独开口子。

- 类型：标准 Claude Code MCP 插件（区别于 `plugins/` 下的日报平台 Tinia 插件）。
- 分发：经 felag-server 摄取 `mcp/feishu-mail/` 子树 → 签名 → `/dist` → 数字员工客户端装 `engine-home/plugins/feishu-mail/`。
- 设计：见 `巅峰数字员工/docs/superpowers/specs/2026-07-21-felag-official-plugins-feishu-mail-design.md`。

## 结构

```
.claude-plugin/plugin.json   插件 manifest(mcpServers + connectorLogin,占位由 client 展开)
skills/read-mail/SKILL.md    引导数字员工读邮件
dist/feishu-mail.mjs         ⭐ 分发运行时 —— esbuild 单文件 bundle(~1.1MB,含 MCP SDK+zod)
server/                      运行时源码(index.mjs 入口三模式 / feishu.mjs OAuth+邮件 REST)
.env.example                 凭据占位文档(真 .env 由 felag-server 摄取时注入,不进 git)
```

**运行时 = `dist/feishu-mail.mjs`**（已 bundle，跑在 client 捆绑的 node 上，无 node_modules 依赖）。`server/` 是源码，`node_modules/` 是 dev 依赖（gitignore，不入包）。

## 三模式

```
node dist/feishu-mail.mjs serve    # stdio MCP 服务(Agent SDK 拉起)
node dist/feishu-mail.mjs login    # 开浏览器飞书 OAuth,存 user_access_token 到 $FEISHU_AUTH_DIR
node dist/feishu-mail.mjs status   # 打印 {"loggedIn":bool},供 client 判定登录态
```

## 改代码后重新 bundle

```
cd server && npm install
npx esbuild index.mjs --bundle --platform=node --format=esm --outfile=../dist/feishu-mail.mjs
```

## 环境变量（client / felag-server 注入，非硬编码）

- `LARK_APP_ID` / `LARK_APP_SECRET`：飞书应用凭据。真值由 felag-server 摄取时从平台库 `plg_felagplugin_config` 注入包内 `.env`；唯一维护点在日报 `plugins-sync.yaml` 的 `credentials`（name=lark）。
- `FEISHU_AUTH_DIR`：user_access_token 存放目录（client 注入，指向插件目录外 `engine-home/connector-auth/feishu-mail/`，重装插件不丢登录）。

> ⚠️ P2 真机联调核对：飞书 authorize/token 端点参数、mail REST 路径、所需 scope（见 `server/feishu.mjs` 顶部注释）。
