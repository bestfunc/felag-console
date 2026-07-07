# felag-console + felag-console-sync 部署冒烟 SOP

> **⚠️ 2026-07-03 distsync③ 定案（走 A + 直连库）**：felag-server 改为**直连平台 `daily_report` 库**读 published skill → 签名 → `/dist`，**故同步导出包 `felag-console-sync`（app 12）作废、无需部署**（HTTP+API Key 边界多余，见 `README.md`）。本 SOP 里 `felag-console-sync` 相关步骤仅历史留存；**只需部署 `felag-console`（管理包，app 11，已上线 v0.1.1）**。
>
> 两个插件包在日报平台(Tinia v3)上的部署顺序、前置条件、冒烟验证清单。
> 面向运维 / 自己复查用，每步都可勾选、可重复执行。
>
> - `felag-console`：管理插件，`require_api_key=false`，9 个节点 + `ui/SkillManager.tsx`，`migrations/001_init.up.sql` 建 `plg_felagskill_{skills,versions,audit}` 三张表。
> - `felag-console-sync`：只读同步出口，`require_api_key=true`，2 个节点（`sync_manifest`/`sync_fetch`），`migrations: []`，读同一批表。
> - 两者都靠 `required_dbs` 别名 `platform_pg` → 节点内 `DB_PLATFORM_PG_DSN` 连平台 PG。

---

## 0. 前置：凭据 + nginx

> **本期方案（2026-07-02 平台定案，指南 `V3_PLUGIN_ORG_IDENTITY_AND_PLATFORM_DB_GUIDE.md` §③ 已按此更新）**：
> **不单建受限角色。** 插件 database 凭据直接用平台超管 `dr` 账号的 DSN——org 表 + 桥2 表一根连接全通，**零 GRANT、零角色管理**。`dr` 是超管，风险由平台 **build 时 SQL 过滤器（已实现）** 兜住（见 0.2 约束）。故本期**跳过**「建 felag_platform 角色 + GRANT org 表」和「角色须先于 build」的顺序依赖——都不需要了。

### 0.1 凭据中心建数据库凭据（dr 账号）

- 类型：`type=database`，`driver=postgres`
- alias：`platform_pg`（**仅是凭据别名**，与 `tinia-repo.yaml` 的 `required_dbs[].alias` 对齐，节点内读 `DB_PLATFORM_PG_DSN`；不对应任何 DB 角色）。**本平台已建：凭据 id=4，name=platform_pg，已 verify**（dr 账号指向 daily_report）
- DSN（用平台超管 `dr`）：
  ```
  postgres://dr:<DR_PG_PASSWORD>@db:5432/daily_report?sslmode=disable
  ```
  - host 用容器内网名 `db:5432`（平台 PG 端口不对宿主暴露，节点子进程与平台 PG 同在 `dr-net` docker 网络内）
  - 目标库固定 `daily_report`（平台库本身，不是外部库）
- 建完在凭据中心点验证，确认 `verified_at` 非空再进入下一步

### 0.2 migration 的 SQL 过滤约束（`dr` 超管的风险兜底）

`dr` 能读写全库，平台在 build 跑 migration 时用 SQL 过滤器约束插件只能动自己的东西：

- ✅ **可以**：`CREATE ${table_prefix}xxx (...)`（建/改以自己 `table_prefix` 开头的对象）；内联外键引用 org 表（如 `dept_id BIGINT REFERENCES departments(id)`）。
- ❌ **不可以**：碰平台原生表（`DROP/ALTER/INSERT` users/credentials/…）、`GRANT/REVOKE`、`CREATE FUNCTION/TYPE/TRIGGER`、`CREATE EXTENSION`、`COPY`、`ALTER SYSTEM` —— 命中即 **build failed**，日志含 `pluginmigrate: reject ...`，按提示改。
- 本插件 `migrations/001_init.up.sql` 已按此清理：**无任何 GRANT**；FK 约束名带 `${table_prefix}` 前缀。**⚠️ 匿名代码块（`DO ... BEGIN ... END`）会被过滤器当函数级操作 reject——2026-07-02 真机 build 实测确认**（首次 import build failed，日志 `pluginmigrate: reject ... 禁止的语句`）。故后置自引用 FK **不用匿名块包裹**，改用**裸** `ALTER TABLE ${table_prefix}skills ADD CONSTRAINT ${table_prefix}current_version_fk ...`（ALTER 自有表放行；无 IF NOT EXISTS 幂等守卫也安全：桥2 按 filename 只跑一次）。改后重导 build=ready、三表建成。

### 0.3 nginx body 大小

`/api/dag/felag-console*` 路由（含 `felag-console-sync`）需要：

```nginx
client_max_body_size 8m;
```

原因：`skill_create` / `skill_upload_version` 走 `content_b64` 塞进 JSON body；2MB 的包（`appexport.MaxBundleSize`）base64 后膨胀约 4/3 倍 ≈ 2.67MB，会被 nginx 默认的 `client_max_body_size 1m` 直接 413。8M 留出余量。

---

## 1. 包大小预检

`import_app` 有跨仓库 2MB 上限（`appexport.MaxBundleSize = 2MB`），逼近上限时需改走 WebIDE 逐文件上传。

```bash
# worst case：整目录（含 tests/、运行期缓存），是上传大小的上界
du -sb felag-console felag-console-sync
# 近似「纯插件源码」（排除测试与运行期缓存）
du -sb --exclude=__pycache__ --exclude=.pytest_cache --exclude=tests felag-console felag-console-sync
```

实测（本仓库当前状态；两口径都远低于 2MB，无论上传通道是否携带 tests/ 与缓存都安全）：

| 包 | 整目录 worst case | 纯源码（排除 tests/缓存） | 上限 |
|---|---|---|---|
| felag-console | 167404 bytes ≈ 164 KB | 51256 bytes ≈ 50 KB | 2 MB |
| felag-console-sync | 26812 bytes ≈ 26 KB | 6548 bytes ≈ 6 KB | 2 MB |

> ⚠️ `appexport` 本身**不按文件名过滤** `tests/`/`__pycache__`（`server/internal/appexport` 对已组装好的 bundle 只做大小校验，不做内容裁剪）——是否携带这两类文件取决于**上传通道**（WebIDE / CLI `import_app` 打包时是否遵循 `.gitignore`）。故此处给出**整目录上界**，即使上传通道原样打包全目录也仍 < 2MB。`__pycache__`/`.pytest_cache` 已被 `.gitignore` 忽略、不进版本库。

两者远低于 2MB 上限，直接走 `import_app` 整目录上传即可，不需要逐文件上传的退路。

---

## 2. 部署顺序（硬依赖，不可颠倒）

```
① 凭据中心建 database 凭据（dr DSN，alias=platform_pg，见 0.1）+ verify【本平台已建 id=4】
        ↓
② 上传 + build felag-console（管理插件，先建表）
        ↓  确认 plg_felagskill_{skills,versions,audit} 三表出现
③ 上传 + build + publish felag-console-sync（同步出口，后接）
```
（本期无「先建角色」步——dr 账号零角色管理。唯一硬顺序：管理插件建表 **先于** 同步插件上线，靠 `ensure_tables` 预检兜底。）

`felag-console-sync` 的 `sync_manifest`/`sync_fetch` 节点在处理前都会调 `ensure_tables()`（`felag-console-sync/_lib/store_ro.py`），检测 `to_regclass('plg_felagskill_versions')`，表不存在则显式抛错：

```
plg_felagskill_versions 表不存在 — 管理插件 felag-console 必须先 build 建表后再上线本同步插件
```

这就是这个顺序的保护网——万一顺序错了（先装 sync），报错信息会直接指出原因，而不是裸的 `relation "plg_felagskill_versions" does not exist`。

### 2.1 Step A：上传管理插件 felag-console，验桥2建表

```bash
# import_app 上传 felag-console 整目录 → 等 build_status=ready
# 平台 PG 核对建表
docker exec daily-report-pg psql -U bestfunc -d daily_report -c "\dt plg_felagskill_*"
```

验证：
- [ ] build_status = ready（build_log 无报错）
- [ ] `\dt plg_felagskill_*` 列出 `plg_felagskill_skills` / `plg_felagskill_versions` / `plg_felagskill_audit` 三表
- [ ] 若 migration 失败 → 走 §回退 章节（外部 PG）

### 2.2 Step B：上传 + build + publish felag-console-sync

- [ ] import_app 上传 felag-console-sync 整目录 → build_status = ready
- [ ] publish
- [ ] 此时表已存在（Step A 已完成），`ensure_tables` 应静默通过

---

## 3. 冒烟清单（☐ 待平台真机执行）

以下步骤需要在日报平台真机 / 本地起的 dr-server 上跑，本仓库无法直接执行，逐条列出供部署时照做。

### ☐ 冒烟1：管理插件功能全链路（nginx + go + stdin，~1MB 包）

造一个 ~1MB 合法 tar.gz（顶层目录名 == 包名），base64 后走 `skill_create`：

```python
import io, tarfile, base64, json, urllib.request

buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode="w:gz") as tf:
    d = tarfile.TarInfo("smoke/")
    d.type = tarfile.DIRTYPE
    tf.addfile(d)
    data = b"x" * 1_000_000
    f = tarfile.TarInfo("smoke/big.bin")
    f.size = len(data)
    tf.addfile(f, io.BytesIO(data))

b = base64.b64encode(buf.getvalue()).decode()
body = json.dumps({
    "name": "smoke",
    "scope_ref": "dept:ops",
    "version": "1.0.0",
    "content_b64": b,
}).encode()

req = urllib.request.Request(
    "http://localhost:18923/api/dag/felag-console/skill_create",
    body,
    {"Content-Type": "application/json"},
)
print(urllib.request.urlopen(req).read().decode())
```

验证：
- [ ] 返回 `results[0].output.result.skill_id` 非空
- [ ] 确认 ~1MB base64 body 过 nginx + go + stdin 全链路未被截断
- [ ] 生产环境确认 `client_max_body_size ≥ 8M` 已生效（见 0.3）

### ☐ 冒烟2：菜单 + UI mount 路由

```
publish 管理插件 → 切 /apps → sidebar 出现「Skill 管理」（ListChecks 图标）
点击 → 期望落 /plugin/felag-console/main（非 /_ui），页面正常渲染列表
```

验证：
- [ ] sidebar 出现「Skill 管理」菜单项，图标为 ListChecks
- [ ] 点击后路由落在 `/plugin/felag-console/main`（非 `/_ui`——这是 spec 已知的文档矛盾点，此处以实测为准）
- [ ] 列表 / 建 / 审核 / 下架 UI 均可用
- [ ] 若 babel 报某组件未在白名单 → 找日报团队补 plugin-sdk re-export

### ☐ 冒烟3：同步插件 + API Key gate

> **⚠️ 关键（2026-07-02 真机确认）**：`require_api_key` **不是从 tinia-repo.yaml 读的**——它是 **app 级 DB 字段**（`models.go` `default:false`），只能通过 **`PUT /api/apps/:id/require-api-key`**（或平台 UI 的对外接口开关）切换。`tinia-repo.yaml` 里写的 `require_api_key: true` 是**未知键、被忽略**！**import felag-console-sync 后它默认 `false`＝未受保护、匿名可拉全部 published skill**。→ **必须手动把 felag-console-sync（本平台 app id=12）的 `require_api_key` 置 true**，否则下面的 401 验证会直接失败（无 Key 也返 200）。MCP 无此工具，走 API/UI。felag-console（管理包）保持 false 正确。

```bash
# 先把 sync 包置 require_api_key=true（app id=12）：
# curl -X PUT http://192.168.2.121:8332/api/apps/12/require-api-key -d '{"require_api_key":true}' -H "Content-Type: application/json" -H "<平台鉴权>"

# 无 Key 调 → 期望 401（前提: 上面已置 true）
curl -s -X POST http://localhost:18923/api/dag/felag-console-sync/sync_manifest -d '{}' ; echo

# 建一个 scope 限到 felag-console-sync 两个 dag 的 API Key，带 Key 调 → 200 + items
curl -s -X POST http://localhost:18923/api/dag/felag-console-sync/sync_manifest \
  -H "Authorization: Bearer dr_<key>" -d '{}' ; echo
```

验证：
- [ ] 无 Key → 401 `missing API key`
- [ ] 带 Key → 200，返回 `{items:[...含冒烟1建的 smoke...], tombstones:[]}`
- [ ] `sync_fetch {name:"smoke", version:"1.0.0"}` 带 Key 调用返回 `content_b64`，其 sha256 与冒烟1上传内容一致

### ☐ 冒烟4：部署顺序保护（干净库场景）

在一个**没有** `plg_felagskill_*` 表的干净库上，**仅**装 sync 插件（不装管理插件）并调 `sync_manifest`：

验证：
- [ ] 返回明确的"表不存在，管理插件须先建表"错误（`plg_felagskill_versions 表不存在 — 管理插件 felag-console 必须先 build 建表后再上线本同步插件`），而非裸 `relation "plg_felagskill_versions" does not exist`
- [ ] 证明 `ensure_tables()` 预检在部署顺序颠倒时生效

---

## 4. 回退：桥2 建表失败 → 外部 PG

若 Step A 的 migration 失败（`build_log` 报错、桥2 无法在平台 PG 建表），按 spec §9 的退路：

- 桥2 表 + 插件数据改放插件自控的**外部 PG**（新建一个独立的 `type=database` 凭据指向插件自己的库，而非平台 `daily_report`）。
- 代价：**org 表（`departments`/`positions`）不再同库**，`plg_felagskill_*` 表无法与 org 表 SQL join；`departments`/`positions` 只能改走 org 只读 API（`GET /api/org/departments` / `GET /api/org/positions`）或依赖节点身份直通（`rt.dept`）。
- 仅在"直连平台 PG 走不通"时启用此退路，不作为默认方案——默认方案是本 SOP 第 2 节的桥2 直连。

---

## 5. 附录：psycopg2 版本锁定

`felag-console-sync` 两个节点（`sync_manifest`/`sync_fetch`）的 `runtime/requirements.txt` 均锁定：

```
psycopg2-binary==2.9.10
```

（`felag-console` 各节点 `requirements.txt` 同样依赖 psycopg2，版本对齐平台 wheelhouse。）

平台 build 走离线 wheelhouse，不联网拉包。首次上线前建议本地验证该版本在 wheelhouse 里存在：

```bash
pip install --no-index -f <wheelhouse> psycopg2-binary==2.9.10
```

若报找不到包，需要平台运维把该版本 wheel 补进 wheelhouse，否则 build 会在依赖安装阶段失败。
