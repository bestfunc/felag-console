-- client 用户上传的私有 skill 暂存区。felag-server 写(status='pending')、console 审核读。
-- 与治理表 skills/versions 解耦的根因:上传时还没有 scope_ref(作用域由管理员审核时才定),
-- 而 skills.scope_ref 是 NOT NULL —— 故私有件不能直接落治理表,先在此暂存,审核通过才搬进去。
-- 平台 build SQL 过滤:只建以 ${table_prefix} 开头的对象、禁 GRANT/函数/触发器(见 001 注释)。
CREATE TABLE IF NOT EXISTS ${table_prefix}uploads (
  id                 BIGSERIAL PRIMARY KEY,
  owner_username     TEXT NOT NULL,       -- 平台 users.username(上传者;felag-server 从 JWT 落)
  owner_dept_ref     TEXT,               -- 上传者所在部门 scope_ref(dept:<id>);审核队列按此过滤可管范围。可空(未分配部门)
  name               TEXT NOT NULL,       -- skill 名(== 包顶层目录名)
  version            TEXT NOT NULL,       -- 上传者声明的版本
  content            BYTEA NOT NULL,       -- 未压缩 tar(与 skill_create 暂存态同构;审核通过时才 gzip 打包)
  size_bytes         INT NOT NULL,
  sha256             TEXT NOT NULL,       -- 未压缩 tar 的 sha256(仅上传完整性;发布时按 tar.gz 重算分发 sha)
  description        TEXT,               -- SKILL.md 摘要(展示用,可空)
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewer           TEXT,               -- 审核人 users.id
  reject_reason      TEXT,
  published_skill_id BIGINT,             -- approve 后落成的治理 skill id(审计追溯;不设 FK,避免跨生命周期 RESTRICT)
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at        TIMESTAMPTZ
);
-- 审核队列热路径:待审 + 按上传者部门过滤。
CREATE INDEX IF NOT EXISTS ${table_prefix}uploads_pending
  ON ${table_prefix}uploads (status, owner_dept_ref);
-- 供 felag-server GET /skills/mine 按 owner 反查本人上传件状态。
CREATE INDEX IF NOT EXISTS ${table_prefix}uploads_owner
  ON ${table_prefix}uploads (owner_username);
