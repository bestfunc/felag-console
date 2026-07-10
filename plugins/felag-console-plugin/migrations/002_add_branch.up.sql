-- 002: sources 加 branch 列(分支可配,默认 main);唯一键含 branch
-- (同仓同插件不同分支 = 不同源)。全 ALTER 自有前缀表,不碰平台原生对象,守桥2铁律。
ALTER TABLE ${table_prefix}sources ADD COLUMN IF NOT EXISTS branch TEXT NOT NULL DEFAULT 'main';
ALTER TABLE ${table_prefix}sources DROP CONSTRAINT IF EXISTS ${table_prefix}sources_git_url_plugin_scope_ref_key;
ALTER TABLE ${table_prefix}sources DROP CONSTRAINT IF EXISTS ${table_prefix}sources_git_plugin_scope_branch_key;
ALTER TABLE ${table_prefix}sources ADD CONSTRAINT ${table_prefix}sources_git_plugin_scope_branch_key UNIQUE (git_url, plugin, scope_ref, branch);
