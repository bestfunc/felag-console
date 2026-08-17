# felag-console-model —— 模型与密钥 · 部署说明

日报平台(Tinia v3)插件。给超管一个页面维护**数字员工可用的 LLM 模型与上游密钥**,
替代此前"改 `litellm-config.yaml` + `docker compose up -d`"的手工流程。

## 这条链路上密钥去了哪(先看这个)

```
本页面表单
   │  POST /api/dag/felag-console-model/model_upsert   (平台内,超管身份)
   ▼
插件节点(_lib/server.py)
   │  POST <felag_server_base>/admin/models            (共享服务令牌)
   ▼
felag-server(internal/modeladmin)
   │  POST <LiteLLM>/model/new                          (master key,server 侧持有)
   ▼
LiteLLM 自己的 PG  ←── 密钥落在这里,仅此一处
```

🔒 **密钥不进日报平台库**。本插件的 `plg_felagmodel_*` 只有两张表:`config`(连接配置)和
`audit`(操作审计),**没有 models 表**——模型的真相源是网关,这里只是它的治理界面。
审计只记模型名与密钥的"形态"(如「引用环境变量 DEEPSEEK_API_KEY」/「已更新为新的明文密钥」),
不记值;列表接口由 felag-server 脱敏后返回,只有 `keyConfigured` / `keyRef`,**读不回密钥**。

这是 M5(LLM key 永不出 Server)的落地形态,也对齐既有的"密钥与计费不自建、用 LiteLLM 原生能力"决策。

## 前置条件

1. **网关**:LiteLLM 必须开 `STORE_MODEL_IN_DB=True`
   (`felag-token-gateway/docker-compose.yml` 已开),否则 `/model/new` 会被拒。
2. **felag-server**:`.env` 配 `FELAG_MODEL_ADMIN_TOKEN`(`openssl rand -hex 24`)后重启。
   **不配 = `/admin/models` 整组端点 404**(不挂比"猜不中令牌"更安全)。
   🔒 该令牌能改网关的模型与上游密钥,等同于 LLM 账单的钥匙,与 JWT secret 同级保管。
3. **平台凭据**:凭据中心需有 `alias=platform_pg` 的 database 凭据(driver=postgres,指向 `daily_report`)。

## 上线步骤

1. 在 `bestfunc/felag-console` 仓(**分支 `main`**)走 `/version-commit`,
   只 stage `plugins/felag-console-model/`,tag `felag-console-model-vX.Y.Z`。
2. 经 `@daily-report` MCP 发布(与另外两个插件同流程):
   `get_app` → `update_app(files=[...])` → 等 `build_status=ready` → `publish_app`。
   ⚠️ 本插件是**新 app**,首次需在平台建应用取得 app id,并把 id 记回 `docs/RELEASE.md`。
3. 进页面 →「连接配置」填 `felag-server` 地址(容器内互通用服务名,如 `http://felag-server:28080`)
   与步骤 2 生成的服务令牌 → 保存。
4. 冒烟:页面能列出网关现有模型(`deepseek-v4-pro` 等,来源显示「配置文件」)。

## 两类模型的区别

| 来源徽标 | 含义 | 可否在本页改/删 |
|---|---|---|
| **配置文件** | 写在 `litellm-config.yaml` 里的(如现有的 `deepseek-v4-pro`) | ❌ 只能在网关配置文件里改,网关会拒绝删 |
| **本页面注册** | 经本页面写进 LiteLLM 库的 | ✅ 可改可删 |

想把配置文件里的模型转为可在线管理,需先从 yaml 移除、再在本页重新注册(会有一次短暂不可用,建议避开业务高峰)。

## 密钥填写方式

- **真实密钥**:直接粘贴,提交后由网关保存,此后本页面只显示「已配置」,读不回来。
- **`os.environ/XXX`**:引用网关侧环境变量(现有 `deepseek-v4-pro` 就是 `os.environ/DEEPSEEK_API_KEY`)。
  这种方式密钥仍留在网关的 `.env` 里,页面只显示引用名 —— 引用名不是秘密。
- **留空**:不改动已有密钥。只想改上游地址或模型名时用。

## 已知约束

- 平台图标只认 41 个白名单,`menu_icon: Settings` **未经本平台实测**;若上线后侧栏没图标,
  换成已验证过的 `Send` / `ListChecks` / `GitBranch`(`Rocket`/`Boxes`/`Link2` 都不在表里)。
- UI 只能用内联 style(平台 Tailwind 不认插件自带 token),具名导入受 `tests/test_ui_imports.py` 白名单守护。
- 平台库依赖约束(零 GRANT / 禁匿名 DO 块)同 `felag-console/DEPLOY.md`。
