# felag-app-release 部署 SOP

> 客户端版本管理插件(Tinia v3)+ felag-server 发布后端的部署与冒烟清单。面向运维/自查,每步可勾选、可重复。
>
> - `felag-app-release`:管理插件,`require_api_key=false`(仅超管经日报平台登录态调用),4 个节点 + `ui/AppReleaseManager.tsx`,`migrations/001_init.up.sql` 建 `plg_felagapp_{releases,audit,config}` 三表。
> - 靠 `required_dbs` 别名 `platform_pg` → 节点内 `DB_PLATFORM_PG_DSN` 连平台 PG(`daily_report`)。
> - **配对的 felag-server 版本 ≥ v0.0.21**(带平台感知 manifest/download + `/app/update/upload|delete` 端点 + `FELAG_APP_UPDATE_DIR` 卷)。

---

## 0. 前置:凭据 + 卷 + nginx

### 0.1 平台库凭据(dr 账号)
- 与 felag-console / felag-console-plugin **同一个** database 凭据即可:`type=database`/`driver=postgres`/alias=`platform_pg`,dr DSN 指向 `daily_report`(本平台已建 **凭据 id=4**,已 verify)。无需新建。

### 0.2 felag-server 侧:持久卷 + 上传令牌(必须先于插件上传)
`deploy/docker-compose.yml`(felag v0.0.21 已改)给 server 服务加:
```yaml
    environment:
      FELAG_APP_UPDATE_DIR: /data/app-releases
      FELAG_APP_UPLOAD_TOKEN: ${FELAG_APP_UPLOAD_TOKEN}
    volumes:
      - felag-app-releases:/data/app-releases
```
顶层 `volumes: { felag-app-releases: {} }`。在 `deploy/.env` 填 `FELAG_APP_UPLOAD_TOKEN`(现场生成 `openssl rand -hex 24`),`docker compose up -d`(改 env 必须 recreate,`docker restart` 不重读)。

### 0.3 nginx body 大小(关键)
安装包最大 300MB,经 `content_b64`(base64,膨胀约 4/3)塞进 `/api/dag/felag-app-release/release_upload` 的 JSON body。nginx 该路由需:
```nginx
client_max_body_size 400m;
```
否则大安装包上传直接 413。(felag-server 侧 upload 端点自身限 300MB,超限返 413。)

---

## 1. 部署顺序(硬依赖)
```
① 平台库凭据已 verify(id=4,复用)
        ↓
② felag-server 升 v0.0.21 + 配卷 + FELAG_APP_UPLOAD_TOKEN(0.2)
        ↓
③ 上传 + build felag-app-release(建 plg_felagapp_{releases,audit,config} 三表)
        ↓
④ 下发两项插件配置到 plg_felagapp_config(见 2)
        ↓
⑤ nginx client_max_body_size 400m(0.3)
```

### 1.1 Step ③:上传插件,验建表
```bash
# import_app 上传 felag-app-release 整目录 → 等 build_status=ready(桥2 跑迁移)
docker exec daily-report-pg psql -U bestfunc -d daily_report -c "\dt plg_felagapp_*"
```
- [ ] build_status=ready(build_log 无 `pluginmigrate: reject`)
- [ ] `\dt plg_felagapp_*` 列出 `plg_felagapp_releases` / `plg_felagapp_audit` / `plg_felagapp_config` 三表
- [ ] 迁移守桥2:无 GRANT / 无匿名 DO 块 / 只建自有前缀对象(含 partial unique index)

---

## 2. 插件配置下发(plg_felagapp_config,SQL 直填)
平台 worker 只注厳选 env,故 felag-server 基址与上传令牌走平台库 config 通道(与 felag-console-plugin 的 `github_token` 同构):
```sql
INSERT INTO plg_felagapp_config (k, v) VALUES
  ('felag_server_base', 'http://felag-server:28080'),   -- dr-net 内网名;或 http://192.168.2.121:28080
  ('felag_app_upload_token', '<与 server FELAG_APP_UPLOAD_TOKEN 同值>')
ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
```
- [ ] `felag_app_upload_token` **与 server env `FELAG_APP_UPLOAD_TOKEN` 逐字符一致**(常量时间比较,不一致上传 401)
- [ ] `felag_server_base` 从插件 worker 容器可达(优先 dr-net 内网名 `felag-server:28080`)

---

## 3. 冒烟清单(☐ 平台真机执行)

### ☐ 冒烟1:菜单 + UI mount
publish 后切 `/apps` → sidebar 出现「客户端版本」(Rocket 图标)→ 点击落 `/plugin/felag-app-release/main`,页面渲染 Windows / macOS 两分区。
- [ ] 菜单项出现、点击渲染正常(babel 报组件未在白名单 → 找日报团队补 plugin-sdk re-export;本插件已按已验白名单选组件/图标)

### ☐ 冒烟2:Windows 上传 → 发布 → 客户端验签往返
1. 上传一个 Win exe(版本 `0.0.27`)→ 列表出现「已上传」行。
2. 点「发布」→ 该行变「当前在线」。
3. server 侧验:
```bash
curl -s "http://192.168.2.121:28080/app/update/manifest?platform=windows" -H "Authorization: Bearer <client JWT>"
# 期望返 {version:"0.0.27", url:"/app/update/download?platform=windows", sha256, sig, notes}
curl -s "http://192.168.2.121:28080/app/update/download?platform=windows" -H "Authorization: Bearer <client JWT>" -o /tmp/dl.exe
sha256sum /tmp/dl.exe   # 与 manifest.sha256 一致
```
- [ ] manifest 返当前版 + 验签过(client 内置公钥验 name=`felag-client`/version/sha256/sig)
- [ ] download sha256 与 manifest 一致

### ☐ 冒烟3:macOS 独立
上传 Mac dmg(版本 `0.0.27`)→ 发布 → `?platform=darwin` 独立返 dmg 版本,与 windows 互不影响。
- [ ] `?platform=darwin` 返 dmg 记录;发布 darwin 不改 windows 当前版

### ☐ 冒烟4:回滚 + 删除守卫
- [ ] 发布旧 Windows 版(如 `0.0.26`)→ manifest 返旧版(回滚生效,只切同平台)
- [ ] 删非当前版 → 盘上文件 + 元数据行都删
- [ ] 删当前在线版 → 被拒(UI 删除按钮对当前版禁用;节点层也拒)

---

## 4. 附录
- **psycopg2 版本**:各节点 `runtime/requirements.txt` 锁 `psycopg2-binary==2.9.10`(对齐平台 wheelhouse,离线 build)。
- **信任链不变**:客户端下载后仍双验 sha256(server 落盘算、记录带)+ ed25519(server 私钥现签、client 内置公钥验)。存储换成 server 本地卷不影响。
- **env 兜底**:平台库表未建 / 无当前发布时,server `CurrentRelease` 返 nil → 退化 env(`FELAG_APP_UPDATE_VERSION/INSTALLER_PATH/NOTES`,仅 windows),不回归旧行为。
