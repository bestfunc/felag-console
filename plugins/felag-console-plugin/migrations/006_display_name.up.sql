-- 006: sources 加 display_name 列(展示名,建源时用户手填的友好名)。
-- plugin 列是 plugin.json 的技术包名(felag-server 摄取时硬校验相等,不可改),
-- display_name 才是给人看的名字,一路下发到 client 连接器卡展示。可空;空时前端回退用 plugin。
-- 全 ALTER 自有前缀表,不碰平台原生对象,守桥2铁律。
ALTER TABLE ${table_prefix}sources ADD COLUMN IF NOT EXISTS display_name TEXT;
