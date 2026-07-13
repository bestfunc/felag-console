-- felag-app-release 建表:客户端安装包发布元数据 + 审计 + 插件级 KV 配置。
-- 只存元数据(不存字节;安装包字节落 felag-server 本地卷)。全自有前缀表,不碰平台原生对象,守桥2铁律。
CREATE TABLE IF NOT EXISTS ${table_prefix}releases (
  id          BIGSERIAL PRIMARY KEY,
  version     TEXT NOT NULL,                       -- 如 0.0.27
  platform    TEXT NOT NULL,                       -- 'windows' | 'darwin'(与客户端 runtime.GOOS 对齐)
  notes       TEXT NOT NULL DEFAULT '',
  filename    TEXT NOT NULL,                        -- server 盘上文件名,如 felag-client-setup-v0.0.27.exe / felag-client-v0.0.27.dmg
  sha256      TEXT NOT NULL,                        -- server 落盘时算,小写十六进制
  size        BIGINT NOT NULL DEFAULT 0,
  uploaded_by TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_current  BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (version, platform)
);
-- 每个平台至多一个当前版(Win/Mac 各自独立);发布=切同平台 current,不影响另一平台。
CREATE UNIQUE INDEX IF NOT EXISTS ${table_prefix}releases_one_current_per_platform
  ON ${table_prefix}releases (platform) WHERE is_current;

CREATE TABLE IF NOT EXISTS ${table_prefix}audit (
  id        BIGSERIAL PRIMARY KEY,
  actor     TEXT,
  action    TEXT NOT NULL,
  target    TEXT,
  detail    JSONB,
  ts        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 插件级 KV 配置:felag_server_base(felag-server 基址)+ felag_app_upload_token(上传/删除共享服务令牌)。
-- 平台 worker 只注厳选 env,故这两项走节点已有的平台库通道下发(与 felag-console-plugin 的 github_token 同构)。
CREATE TABLE IF NOT EXISTS ${table_prefix}config (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL DEFAULT ''
);
