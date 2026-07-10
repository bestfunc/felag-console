-- 003: 插件级 KV 配置表。首个用途 = 探测用 GitHub token(key='github_token')。
-- 平台 worker 只给节点注入厳选 env(不转发自定义 GITHUB_TOKEN),故 token 走节点已有的
-- 平台库通道下发:此表存 token,plugin_discover 读它带认证下载,治 codeload 匿名 429。
-- 全自有前缀表,不碰平台原生对象,守桥2铁律。
CREATE TABLE IF NOT EXISTS ${table_prefix}config (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL DEFAULT ''
);
