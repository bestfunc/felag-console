# felag-console-expert 部署 SOP

> 「专家」(岗位人格)治理插件 + 配套的 felag-server 下发腿。面向运维/自查,每步可勾选、可重复。
>
> - **专家是什么**:数字员工的岗位人格。技能说「怎么做一件事」,连接器把外部系统接进来,**专家说「以什么身份、按什么顺序判断」**。三者是装配关系。格式契约见 `felag-client/docs/EXPERT-SPEC.md`。
> - **内容形态与 skill 不同**:专家只有一份 `EXPERT.md` 文本,**下发的是原始字节、不是 tar.gz 包**。客户端因此不走解包腿,少一整类解包风险。
> - **配对的 felag-server 版本 ≥ 本次发布版**(带 `/dist/experts/*`)。server 没升级 → 插件能用、能审、能发布,但**客户端拉不到**,表现为「治理后台有,客户端没有」。

---

## 0. 前置:一条数据库凭据

插件只用平台库,凭据中心要有 `type=database` / `driver=postgres` 的:

| alias | 指向 | 说明 |
|---|---|---|
| `platform_pg` | `daily_report` | 与 `felag-console` / `felag-app-release` **同一条**,已存在无需新建。**id 各环境不同**,以凭据中心里 name=`platform_pg` 的那条为准。 |

> ⚠️ 少配的症状:节点起步即报 `DB_PLATFORM_PG_DSN 未注入`。

---

## 1. 部署顺序(硬依赖)

```
① 平台导入/构建本插件 → build ready → 菜单出现「Félag → 专家管理」
        ↓
② felag-server 升级(带 /dist/experts/*)—— 不升的话客户端拉不到
        ↓
③ 建第一个专家 → 审核发布
        ↓
④ 客户端「同步」→ 能力市场「专家」tab 出现
```

**①② 谁先谁后都行**。server 先上时,`ExpertManifestFor` 会因为表不存在(PG `42P01`)**退化成空清单**,客户端显示「还没有专家」而不是报错 —— 这是设计好的降级,不是故障。

---

## 2. 冒烟(部署后必做)

1. 用**有管理权限**的账号进「Félag → 专家管理」→「新建专家」→ 模板改两个字 → 保存。
   - 应提示「已保存,进入待审」,列表里状态是 `待审`。
2. 点「通过发布」→ 状态变 `已发布`。
3. 直接打服务端(用该用户的 JWT):
   ```bash
   curl -s "$SERVER/dist/experts/manifest" -H "Authorization: Bearer $JWT"
   # → {"experts":[{"name":"...","version":"...","sha256":"...","signature":"...","fetch_url":"/dist/fetch/expert/..."}],"signature":"..."}
   curl -s "$SERVER/dist/fetch/expert/<name>/<version>" -H "Authorization: Bearer $JWT"
   # → EXPERT.md 原文(Content-Type: text/markdown)
   ```
4. 换一个**不在该作用域**的账号打同样两个接口:manifest 里不应出现它,fetch 应回 **404**(不暴露存在性)。
5. 客户端点「同步」→ 能力市场「专家」tab 出现该专家 → 点「开始对话」→ 顶栏出现专家标记。

---

## 3. 排障

| 症状 | 原因 / 处理 |
|---|---|
| 治理后台有,客户端拉不到 | felag-server 版本低于带 `/dist/experts/*` 的版本;或客户端没点「同步」。 |
| `/dist/experts/manifest` 恒返回空 | ① 插件未装 → 表不存在,按 `42P01` 退化(预期);② 该用户不在任何已发布专家的作用域内;③ 专家状态不是 `published`。 |
| fetch 回 500 `integrity check failed` | 库里的 `body` 被旁路改写、与登记的 `sha256` 对不上。**不要改 sha 去凑**,重新在 UI 里保存一次让它重算。 |
| 保存报「不允许改名」 | 改名等于换一个客户端落盘目录(`experts/<name>/`),旧目录不会被清掉。要换名字就新建一个。 |
| 已发布的专家改了正文,状态自己变回待审 | **这是刻意的**。不这样的话,等于用一次通过的审核放行了没审过的内容。 |
| 点了「下架」,客户端还有 | 下架只停止**继续下发**;已装到客户端的副本不会被远程删除。与 skill / 插件腿是同一个缺口。 |

---

## 4. 已知缺口

- **下架不回收**(见上)。要真回收得让 manifest 带「撤销清单」,客户端据此删本地副本 —— 三条分发腿都没做,要做该一起做。
- **无版本历史**。专家表整行覆盖,不像 skill 那样留 versions。要看改了什么只能查审计表(`plg_felagexpert_audit`)。当初这么定是因为专家只有一份文本、覆盖即可;真需要回滚再加一张表。
- **写操作不暴露给 MCP**。`expert_save` / `expert_review` / `expert_deprecate` 决定「数字员工以什么身份工作」并直接下发到所有客户端,属不可逆治理动作,刻意只留给人在 UI 里做。
