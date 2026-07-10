-- 005: sources 加 git_version 列。felag-server 摄取 approved 源时写回该源 branch HEAD 的插件版本;
-- console 列表直接读列展示,不再在加载时逐行同步探 GitHub(原实现随源数线性变慢、受 121→github
-- 抖动/限流拖垮,单源最坏 12s 串行叠加顶穿节点 30s 硬截止)。draft/未摄取源该列为 NULL,前端展示 '—'。
-- 全 ALTER 自有前缀表,不碰平台原生对象,守桥2铁律。
ALTER TABLE ${table_prefix}sources ADD COLUMN IF NOT EXISTS git_version TEXT;
