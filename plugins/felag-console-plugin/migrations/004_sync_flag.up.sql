-- 004: sources 加 sync_requested_at 列。console 点「更新」置 now();felag-server 快轮询
-- 读它、与自己记的上次处理值等值比较,不同则立即重摄该源(避开 15min 定时轮询延迟)。
-- 全 ALTER 自有前缀表,不碰平台原生对象,守桥2铁律。
ALTER TABLE ${table_prefix}sources ADD COLUMN IF NOT EXISTS sync_requested_at TIMESTAMPTZ;
