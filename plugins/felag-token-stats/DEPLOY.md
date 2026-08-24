# felag-token-stats 部署 SOP

> LLM token 用量统计插件(Tinia v3)+ felag-server 用量归属腿的部署与冒烟清单。面向运维/自查,每步可勾选、可重复。
>
> - `felag-token-stats`:治理插件,仅超管可用(节点层 fail-closed),3 个节点 + `ui/TokenStats.tsx`,`migrations/001_init.up.sql` 只建 `plg_felagtoken_audit` 一张审计表。
> - **用量数据不在平台库**:真相源是网关 LiteLLM 自己的 `litellm.LiteLLM_SpendLogs`,插件只读、不做副本(副本必然与网关账单对不上)。
> - **配对的 felag-server 版本 ≥ v0.0.36**(在 `/llm/proxy` 注入用量归属头)。server 没升级 → 页面能打开、有总量,但**所有行都是「未归属」**。
> - 设备名列还需 **felag-client ≥ v0.0.42**(发请求带 `X-Felag-Device`);没升的客户端该列显示 `—`,不影响其他列。

---

## 0. 前置:两个数据库凭据

插件跨两个库,**且不能 join**(SQL 跨不过库,归属解析在 Python 里 merge)。凭据中心要有两条 `type=database` / `driver=postgres`:

| alias | 指向 | 说明 |
|---|---|---|
| `platform_pg` | `daily_report` | 与 felag-console / felag-app-release **同一条**,已存在无需新建(121 上是凭据 **id=16**;**id 各环境不同,以凭据中心里 name=`platform_pg` 的那条为准**)。查 `users`/`departments` 把 user_id 解析成姓名与部门,审计表也在这。 |
| `litellm_pg` | `litellm` | **需新建**。121/175 上 litellm 库与 daily_report **同属 dr-pg 实例**,所以照抄 platform_pg 的 DSN、只把库名从 `daily_report` 换成 `litellm` 即可,网络天然可达。 |

> ⚠️ 少配 `litellm_pg` 的症状:节点起步即报 `DB_LITELLM_PG_DSN 未注入`。

---

## 1. 部署顺序(硬依赖)

```
① 凭据中心建 litellm_pg 并 verify
        ↓
② felag-server 升级(带归属注入)—— 不升的话统计页全是「未归属」
        ↓
③ 平台导入/构建本插件 → build ready → 菜单出现「Token 用量」
        ↓
④ (可选)felag-client 升级 —— 只影响「设备」列
```

**②③ 谁先谁后都行**,但 ② 之前发生的历史请求**永远补不回归属**(网关账本里当时就没记),它们会一直算在「未归属」里 —— 这是预期行为,不是 bug。

---

## 2. 冒烟(部署后必做)

1. 用**超管**登录日报平台 → 侧栏「Félag → Token 用量」→ 选「近 7 天」。
   - 汇总卡有数、趋势条有柱 → 插件到 litellm 库的读通了。
2. 用**非超管**账号打开同一页 → 应报「仅超管可查看 token 用量统计」(fail-closed 生效)。
3. 用 felag-client 发一句对话 → 回到本页刷新 → 明细第一行应是这次请求,**员工列是发起人的姓名**(不是「未归属」)。
   - 若是「未归属」→ felag-server 没升级,或客户端没经 `/llm/proxy` 走。
4. 点「导出 CSV」→ 文件能开、中文列名不乱码(CSV 带 BOM)。平台库 `plg_felagtoken_audit` 应多一条 `export` 记录。

---

## 3. 排障

| 症状 | 原因 / 处理 |
|---|---|
| 全部行「未归属」 | felag-server 版本低于 v0.0.36,`/llm/proxy` 还没注入归属头。升级 server 后**新产生**的请求才有归属。 |
| 「今天」少了一截 / 用量对不上日子 | spend logs 存的是 **UTC**(121/175 宿主机也跑在 UTC),页面按 `Asia/Shanghai` 换算。若换算被绕过,北京时间上午的用量会被算进前一天。节点 `tz` 参数默认 `Asia/Shanghai`,一般不用动。 |
| 成本列大量 0 | 网关没给该模型配单价 —— token 数是准的,成本不是。要成本准,去「模型与密钥」把上游单价配全。**别据此判断"没花钱"**。 |
| 员工列显示成 `#7` 或英文用户名 | 该员工已从平台删除 → 平台库 join 不到 → 回落网关账本里的快照名。属预期兜底。 |
| 导出报「超过单次导出上限」 | 单次上限 20000 条,缩小时间范围再导。 |
| 页面白屏 | 侧栏图标 `BarChart3` 若不在平台 41 个图标白名单里,会 React error #130。换成已验证的 `Send` / `ListChecks` / `GitBranch`。 |

---

## 4. 数据口径备忘(看数前先读)

- **归属来自 server 注入,不是 LiteLLM 的 `user` 列**。felag-server 对所有数字员工共用同一把 master key,LiteLLM 自己的 `user` 恒为 `default_user_id` —— 谁要是按那一列做统计,会得到"全公司只有一个人"。
- 归属稳定键是**平台 users.id**;姓名与部门每次查询都从平台库现取,员工改名后历史记录跟着改名(而不是留着旧名)。
- 明细**不含 prompt / 响应文本**(spec §9 R5:治理后台不看员工请求内容),只有归属 + 用量 + `request_id` 供溯源。
