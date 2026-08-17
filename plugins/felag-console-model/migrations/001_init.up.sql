-- felag-console-model 建表:插件级 KV 配置 + 审计。
--
-- 🔒 注意这里**没有 models 表**,是刻意的:
-- 模型清单的真相源是网关(LiteLLM 自己的库),本插件只是它的治理界面。
-- 上游 LLM key 更是一个字节都不落平台库 —— 它从表单直接经 felag-server 透传给 LiteLLM(M5)。
-- 在这里建一张 models 表意味着要么存 key、要么与网关双写不一致,两条都不可接受。
--
-- 全自有前缀表,不碰平台原生对象,守桥2铁律。

-- 插件级 KV 配置:felag_server_base(felag-server 基址)+ felag_model_admin_token(共享服务令牌)。
-- 平台 worker 只注厳选 env,故这两项走节点已有的平台库通道下发
-- (与 felag-app-release 的 felag_app_upload_token、felag-console-plugin 的 github_token 同构)。
CREATE TABLE IF NOT EXISTS ${table_prefix}config (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS ${table_prefix}audit (
  id     BIGSERIAL PRIMARY KEY,
  actor  TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail JSONB,                                  -- 只记模型名 / 上游 / key 的"形态",绝不记 key 的值
  ts     TIMESTAMPTZ NOT NULL DEFAULT now()
);
