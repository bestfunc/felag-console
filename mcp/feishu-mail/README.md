# feishu-mail —— 飞书官方邮件插件（Claude Code MCP 插件）

数字员工用的**只读飞书邮箱**插件。用户在客户端"连接器"页登录飞书后，数字员工可读取其飞书邮箱邮件（列文件夹 / 列邮件 / 读单封）。

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
