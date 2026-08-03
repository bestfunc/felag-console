---
name: read-mail
description: 读写当前用户的飞书邮箱。当用户要求查看/总结/搜索自己的飞书邮件、收件箱、未读邮件、某封邮件内容、邮件附件，或要求回复/转发/发送邮件、标记已读时使用。
---

# 读飞书邮箱邮件

本技能通过 `feishu` MCP 连接器访问**当前登录用户自己的**飞书邮箱。前提：用户已在客户端「连接器」页对飞书完成登录授权（否则工具返回未授权错误，此时提示用户去登录飞书，**不要自行重试或换别的工具试**）。

## 工具清单与关键参数

| 工具 | 用途 | 必须知道的参数约束 |
|---|---|---|
| `feishu__list_folders` | 列文件夹，拿 `folder_id` | 无参数 |
| `feishu__list_labels` | 列标签，拿 `label_id`（含未读等系统标签）、看各标签未读数 | 无参数 |
| `feishu__list_messages` | 列某文件夹/标签下的邮件 | **`folder_id` 与 `label_id` 必须给其一**；`page_size` **上限 20**；翻页回传 `page_token`；只看未读用 `only_unread: true`。**没有时间过滤、不能反向排序** —— 按时间找邮件一律改用 `search_messages` |
| `feishu__search_messages` | 按关键词/条件搜邮件 | `query` 全文关键词；`filter` 可按 `from`/`to`/`subject`/`folder`/`label`/`has_attachment`/`is_unread`/`create_time` 筛；**`page_size` 上限 15**(与 list 的 20 不同)；`create_time` 用 **ISO 8601**(`"2026-05-01T00:00:00Z"`)；**结果恒时间倒序、无排序参数** |
| `feishu__get_message` | 读单封全文 | `message_id` |
| `feishu__get_messages` | **批量**读详情 | `message_ids` 数组 + `format`：`metadata`(只头部，最省) / `plain_text_full`(默认，纯文本正文) / `full`(含 html) |
| `feishu__get_attachment_links` | 取附件下载直链 | `message_id` + `attachment_ids`（来自 `get_message` 的附件列表）。⚠️ 链接**只能用两次、2 小时失效** |
| `feishu__modify_message` | 加/减标签、移动文件夹 | **唯一写操作**，见下 |
| `feishu__list_contacts` | 列邮箱联系人 | `page_size` 上限 20 |
| `feishu__list_rules` | 列收信规则 | 无参数 |
| `feishu__send_message` | 发新邮件 | `to`(数组) + `subject` + `body_plain_text`；见下「发信规矩」 |
| `feishu__reply_message` | 回复某封 | `message_id` + `body_plain_text`；`reply_all` 可选；引用块自动附加。若报「取不到原邮件的发件人地址」，**不是这封不能回复** —— 用 `search_messages` 取 `meta_data.from.mail_address` 当 `to` 传进来 |
| `feishu__forward_message` | 转发某封 | `message_id` + `to`；**不带原附件** |

## 怎么高效干活（省调用、省 token）

1. **找特定邮件 → 直接 `search_messages`，不要翻页碰运气。**
   例：找「欧摩威 IBC 报价」→ `search_messages({query:"欧摩威 IBC 报价"})`；找某人发的 → `filter:{from:["x@y.com"]}`。
2. **要未读 → `list_messages({folder_id, only_unread:true})` 或 `search_messages({filter:{is_unread:true}})`。**
   不要列全量再逐封 `get_message` 看 `label_ids` 自己筛 —— 那样 100 封要 100 次调用。
3. **总结一批邮件 → 先 `get_messages({message_ids, format:"metadata"})` 扫一遍，锁定要细看的几封再用 `plain_text_full`。**
4. **正文优先 `plain_text_full`**，`full` 的 html 又长又难读，除非用户明确要 html。
5. 翻页要翻到 `page_token` 为空或够用为止，别默认第一页就是全部。
6. **按时间找邮件（某月份 / 最早的一封）→ 用 `search_messages` 的 `filter.create_time` 开窗，不要用 `list_messages` 一页页翻。**
   搜索结果恒按时间倒序且**没有升序选项**，所以找「最早」要靠开窗二分：先给一个宽窗（如整年），有结果就把窗口往早的一半收，直到窗内只剩最早那几封。
7. **时间口径**：`search_messages` 返回 `create_time` 是 ISO 8601；`list/get/get_messages` 原生只有 `internal_date`（epoch 毫秒字符串），本插件已额外补了同值的 `create_time`（ISO），跨工具比对时间就用 `create_time`。

## 附件

`get_message` 返回附件的 `id` 和文件名，**不含内容**。要拿内容：`get_attachment_links` 换直链。链接只能用两次、2 小时过期，所以拿到就用、别缓存、别把旧链接再发一次。本插件不负责把文件落盘 —— 把链接给用户，或交给具备下载能力的工具处理。

## 发信规矩（`send_message` / `reply_message` / `forward_message`）

发出去的邮件**收不回、对外可见、代表用户本人**，所以：

1. **发之前必须把完整草稿念给用户**：收件人（含抄送）、主题、正文全文，等用户明确说「发」再调工具。用户只说「帮我回复一下」不等于授权直接发 —— 先拟稿给他看。
2. **一次只发一封，发完汇报结果**（返回里有 `message_id`）。失败不要自动重试重发，先把错误告诉用户；确需重试用 `dedupe_key` 防重。
3. **别自作主张加收件人**，尤其 `reply_all` —— 用户没说「回复全部」就用默认的单人回复。
4. 回复用 `reply_message`（自动带原文引用、主题 Re:），不要自己用 `send_message` 拼一封假回复。
5. **转发不带原附件**（飞书要求重新上传附件内容）。收件人需要附件时，用 `get_attachment_links` 取链接写进正文，并提醒对方链接 2 小时内有效。
6. 回复不携带 `In-Reply-To` 头，对方客户端靠主题聚合，**不保证串进原会话线程** —— 用户在意线程完整性时如实说明。

## 做不到的事（别再试别的工具，直接如实告诉用户）

- ❌ **删除邮件 / 移入已删除文件夹** —— 未实现（飞书要单独的删除接口）。
- ❌ **下载附件到本地磁盘** —— 只给下载链接；不要去试 `kanban-files`、`wechat-file` 等无关插件的下载工具。
- ❌ **带附件发送 / 转发原附件** —— `send_message` 暂不支持上传附件。
- ❌ **改收信规则、改联系人** —— 规则和联系人都是只读列出。
- ❌ **撤回已发邮件** —— 未实现。

## 写操作规矩（`modify_message`）

这是本插件唯一会改动用户邮箱的工具：

- 标记已读：`remove_label_ids: ["UNREAD"]`；标为未读：`add_label_ids: ["UNREAD"]`；归档/移动：`add_folder: "<folder_id>"`。
- **执行前先说清楚要动哪封、怎么改**，用户确认后再调；不要批量顺手把一堆邮件标成已读。
- 用户只是「想看看」时，绝不顺带改状态。

## 出错处理

- 未授权 / token 失效 / 提示「缺少该能力所需权限」→ 告诉用户：「请在客户端连接器页重新登录飞书。」（本插件 2026-07-28 扩了权限范围，老登录态需重新授权一次才能用新增能力。）**不要自行重试。**
- 接口报参数错（`must pass either folder_id or label_id`、`the max value is 20`）→ 按上表修正参数重试一次即可，不要穷举参数组合。
- 未开通飞书邮箱 / 无邮件 → 如实告知，**绝不编造邮件内容**。
