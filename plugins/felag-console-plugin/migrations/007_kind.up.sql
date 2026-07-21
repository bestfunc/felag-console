-- 007: sources 加 kind 列区分官方插件。''/'git'=第三方录入源(现状,默认);'official'=系统官方插件启用产生的源。
-- felag-server 摄取按 kind 选子树前缀(official→mcp/,git→plugins/)+ 官方源注入凭据 .env(见 felag pluginsrc)。
-- 全 ALTER 自有前缀表,不碰平台原生对象,守桥2铁律。
ALTER TABLE ${table_prefix}sources ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'git'
  CHECK (kind IN ('git','official'));
