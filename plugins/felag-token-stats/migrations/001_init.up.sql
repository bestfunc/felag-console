-- felag-token-stats 建表。
-- 用量数据本身**不在这**:真相源是网关 LiteLLM 自己的 litellm.LiteLLM_SpendLogs,本插件只读它,
-- 不做副本(副本必然与网关账单对不上)。故平台库里只留一张审计表:谁在什么时候导出了哪段用量。
-- 导出会带出员工归属 + 设备 + IP,属敏感读取,留痕。全自有前缀表,不碰平台原生对象,守桥2铁律。
CREATE TABLE IF NOT EXISTS ${table_prefix}audit (
  id      BIGSERIAL PRIMARY KEY,
  actor   TEXT,
  action  TEXT NOT NULL,
  detail  JSONB,
  ts      TIMESTAMPTZ NOT NULL DEFAULT now()
);
