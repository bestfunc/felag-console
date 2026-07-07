# felag-console — Félag Skill 管理（日报平台 v3 插件）

在**日报平台**（巅峰Tina / Tinia v3 插件平台，`D:\Prodect\巅峰Tina项目\日报项目`）上以插件形态开发的 **Skill 管理**后台。felag 治理后台前端（原计划②）不再做独立 React SPA，改为平台插件。组织/用户/角色已由平台统一管，本刀**只做 Skill 管理**，作用域判定**纯组织**（部门子树，不碰 users/权限）。

## 两个插件包（因平台 API Key 网关是插件级，必须拆两包）

| 包 | slug | `require_api_key` | 内容 |
|---|---|---|---|
| `felag-console/`（本目录） | felag-console | false（浏览器同源 + OrgProvider RBAC） | 9 个 Python 节点 + `ui/SkillManager.tsx` 管理页 + `migrations/001`（建共享表） |
| `../felag-console-sync/` | felag-console-sync | true（仅 felag-server 带 Key 拉） | `sync_manifest`（全量快照）+ `sync_fetch`；`migrations: []`，只读同表 |

两包共享平台 PG 的 `plg_felagskill_*` 表（表由管理包 migration 建）。

> **⚠️ distsync③ 定案（2026-07-03，用户拍板走 A + 直连库）**：skill + org 全在平台 `daily_report` 库，**felag-server 直连平台库读** published skill → 验 sha → felag 私钥 ed25519 签名 → 复用现有 `/dist` 分发给 felag-client。**故同步导出包 `felag-console-sync`（app 12）作废**——它的 `sync_manifest/sync_fetch` HTTP + API Key 是"不给直连 DB"才需要的边界，能直连就多余；代码留仓但不再是分发路径，无需部署。**管理走 A**：felag skill store 只由平台喂，felag-server 自己的 `/admin/skills` 上传/审核端点退役（org/RBAC/dist 保留）。felag/ 侧读取器尚未开工。下面关于 `felag-console-sync` 的部署内容仅为历史留存。

## 目录

```
_lib/           db.py(平台PG连接) / orgprovider.py(纯组织RBAC,StubOrgProvider) /
                pkgvalidate.py(tar包最小校验) / store.py(仓储) / nodes_impl.py(节点业务逻辑,集中)
nodes/<key>/    每节点: node.yaml + schemas/params.schema.json + runtime/{run.py 薄壳, requirements.txt}
ui/SkillManager.tsx   管理页(平台运行时 babel 编译,只 import react/@platform/ui/lucide-react)
migrations/001_init.up.sql   建 skills/versions/audit 三表 + 部分唯一索引 + 后置 FK（无 GRANT，见下）
tests/          pytest(每节点 handle + _lib 单元),conftest 提供 conn fixture
DEPLOY.md       部署 + 冒烟 SOP(平台真机执行)
```

## 本地开发 / 测试（TDD）

```bash
# 需本地平台 PG 容器(daily-report-pg)在跑,建一次性测试库:
docker exec daily-report-pg psql -U bestfunc -d postgres -c "CREATE DATABASE felag_console_test;"
# 依赖(python 非 python3):
python -m pip install "psycopg2-binary==2.9.10" pytest
# 跑测试(conftest 默认 DSN = postgres://bestfunc:bestfunc_dev@localhost:5432/felag_console_test):
cd felag-console && python -m pytest -q          # 41 passed
cd ../felag-console-sync && python -m pytest -q  # 5 passed
```

> **本期（2026-07-02 平台定案）**：插件 database 凭据直接用平台超管 `dr` 账号 DSN，一根连接读 org 表 + 读写桥2 表，**零 GRANT、零角色管理**；migration 不写任何 GRANT（会被平台 build SQL 过滤器拦）。`dr` 风险由平台 build 时 SQL 过滤兜住（插件只能建自己 `table_prefix` 前缀对象、禁 GRANT/原生表/FUNCTION 等）。故 conftest 无需建任何角色，直接 DROP+建表跑 migration。详见 `DEPLOY.md`。

## 关键约束（改代码前必看）

- **反查纪律**：`skill_upload_version`/`review`/`detail`/`deprecate`/`version_delete` 的 `scope_ref` **一律由 `skill_id` 反查 DB** 得出，节点绝不接受外部传入 scope_ref；**仅 `skill_create` 信任 `params.scope_ref`**（防横移提权）。
- **纯组织判定**：`can_manage_scope(a,s) ⟺ s∈manageable_scope_refs(a)`，无 is_super、无权限码。坐公司根部门（`is_company`）= 子树=全树。
- **base64 包字节 / DSN 绝不进日志 / emit / stderr**。
- **审核**：条件 UPDATE（`WHERE review_status='pending'`）防并发双发；approve 即发布并同事务置 `current_version`。
- **包上限 2MB**（节点 stdout 单行 scanner 约束）；migration 加表用新文件号 `002_*`，绝不改 `001`。

## 文档

- 设计：`../docs/superpowers/specs/2026-06-30-felag-console-skill-admin-日报平台插件-design.md`（v3.1）
- 实现计划：`../docs/superpowers/plans/2026-06-30-felag-console-skill-admin-implementation-plan.md`（11 任务 TDD）
- 部署 + 冒烟：`DEPLOY.md`
- 节点开发依据：`日报项目/docs/V3_NODE_DEV_GUIDE.md`、库/身份：`日报项目/docs/V3_PLUGIN_ORG_IDENTITY_AND_PLATFORM_DB_GUIDE.md`
