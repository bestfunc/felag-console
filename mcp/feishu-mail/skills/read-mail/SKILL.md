---
name: read-mail
description: 读取当前用户的飞书邮箱邮件。当用户要求查看/总结/搜索自己的飞书邮件、收件箱、最近邮件、未读邮件、某封邮件内容、邮件附件时使用。
---

# 读飞书邮箱邮件

本技能通过 `feishu` MCP 连接器访问**当前登录用户自己的**飞书邮箱。前提：用户已在客户端「连接器」页对飞书完成登录授权（否则工具返回未授权错误，此时提示用户去登录飞书，**不要自行重试或换别的工具试**）。

## 工具清单与关键参数

| 工具 | 用途 | 必须知道的参数约束 |
|---|---|---|
| `feishu__list_folders` | 列文件夹，拿 `folder_id` | 无参数 |
| `feishu__list_labels` | 列标签，拿 `label_id`（含未读等系统标签）、看各标签未读数 | 无参数 |
| `feishu__list_messages` | 列某文件夹/标签下的邮件摘要 | **`folder_id` 与 `label_id` 必须给其一**；`page_size` **上限 20**；翻页把上次返回的 `page_token` 回传；只看未读用 `only_unread: true` |
| `feishu__search_messages` | 按关键词/条件搜邮件 | `query` 全文关键词；`filter` 可按 `from`/`to`/`subject`/`folder`/`label`/`has_attachment`/`is_unread`/`create_time` 筛；`page_size` 上限 20 |
| `feishu__get_message` | 读单封全文 | `message_id` |
| `feishu__get_messages` | **批量**读详情 | `message_ids` 数组 + `format`：`metadata`(只头部，最省) / `plain_text_full`(默认，纯文本正文) / `full`(含 html) |
| `feishu__get_attachment_links` | 取附件下载直链 | `message_id` + `attachment_ids`（来自 `get_message` 的附件列表）。⚠️ 链接**只能用两次、2 小时失效** |
| `feishu__modify_message` | 加/减标签、移动文件夹 | **唯一写操作**，见下 |
| `feishu__list_contacts` | 列邮箱联系人 | `page_size` 上限 20 |
| `feishu__list_rules` | 列收信规则 | 无参数 |

## 怎么高效干活（省调用、省 token）

1. **找特定邮件 → 直接 `search_messages`，不要翻页碰运气。**
   例：找「欧摩威 IBC 报价」→ `search_messages({query:"欧摩威 IBC 报价"})`；找某人发的 → `filter:{from:["x@y.com"]}`。
2. **要未读 → `list_messages({folder_id, only_unread:true})` 或 `search_messages({filter:{is_unread:true}})`。**
   不要列全量再逐封 `get_message` 看 `label_ids` 自己筛 —— 那样 100 封要 100 次调用。
3. **总结一批邮件 → 先 `get_messages({message_ids, format:"metadata"})` 扫一遍，锁定要细看的几封再用 `plain_text_full`。**
4. **正文优先 `plain_text_full`**，`full` 的 html 又长又难读，除非用户明确要 html。
5. 翻页要翻到 `page_token` 为空或够用为止，别默认第一页就是全部。

## 附件

`get_message` 返回附件的 `id` 和文件名，**不含内容**。要拿内容：`get_attachment_links` 换直链。链接只能用两次、2 小时过期，所以拿到就用、别缓存、别把旧链接再发一次。本插件不负责把文件落盘 —— 把链接给用户，或交给具备下载能力的工具处理。

## 做不到的事（别再试别的工具，直接如实告诉用户）

- ❌ **发送 / 回复 / 转发邮件** —— 飞书应用未申请发信权限（`mail:user_mailbox.message:send`）。用户要回复时直接说明「当前插件只能读 + 改标签，发信需管理员在飞书开放平台补开发信权限」，**不要**去试 `send`，也不要绕道别的连接器。
- ❌ **删除邮件 / 移入已删除文件夹** —— 未实现（飞书要单独的删除接口）。
- ❌ **下载附件到本地磁盘** —— 只给下载链接；不要去试 `kanban-files`、`wechat-file` 等无关插件的下载工具。
- ❌ **改收信规则、改联系人** —— 规则和联系人都是只读列出。

## 写操作规矩（`modify_message`）

这是本插件唯一会改动用户邮箱的工具：

- 标记已读：`remove_label_ids: ["UNREAD"]`；标为未读：`add_label_ids: ["UNREAD"]`；归档/移动：`add_folder: "<folder_id>"`。
- **执行前先说清楚要动哪封、怎么改**，用户确认后再调；不要批量顺手把一堆邮件标成已读。
- 用户只是「想看看」时，绝不顺带改状态。

## 出错处理

- 未授权 / token 失效 / 提示「缺少该能力所需权限」→ 告诉用户：「请在客户端连接器页重新登录飞书。」（本插件 2026-07-28 扩了权限范围，老登录态需重新授权一次才能用新增能力。）**不要自行重试。**
- 接口报参数错（`must pass either folder_id or label_id`、`the max value is 20`）→ 按上表修正参数重试一次即可，不要穷举参数组合。
- 未开通飞书邮箱 / 无邮件 → 如实告知，**绝不编造邮件内容**。
