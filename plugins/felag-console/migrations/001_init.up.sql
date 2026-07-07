CREATE TABLE IF NOT EXISTS ${table_prefix}skills (
  id                 BIGSERIAL PRIMARY KEY,
  name               TEXT NOT NULL,
  scope_ref          TEXT NOT NULL,
  current_version_id BIGINT,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deprecated')),
  deleted_at         TIMESTAMPTZ,
  created_by         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ${table_prefix}skills_name_live
  ON ${table_prefix}skills (name) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS ${table_prefix}versions (
  id            BIGSERIAL PRIMARY KEY,
  skill_id      BIGINT NOT NULL REFERENCES ${table_prefix}skills(id) ON DELETE CASCADE,
  version       TEXT NOT NULL,
  content       BYTEA NOT NULL,
  size_bytes    INT NOT NULL,
  sha256        TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','published','rejected')),
  self_review   BOOLEAN NOT NULL DEFAULT false,
  uploaded_by   TEXT,
  reviewed_by   TEXT,
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(skill_id, version)
);

CREATE TABLE IF NOT EXISTS ${table_prefix}audit (
  id        BIGSERIAL PRIMARY KEY,
  actor     TEXT,
  scope_ref TEXT,
  action    TEXT NOT NULL,
  target    TEXT,
  detail    JSONB,
  ts        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- current_version 后置 FK（建表循环：skills.current_version_id→versions.id，versions.skill_id→skills.id）。
-- 后置自引用 FK（建表循环：skills.current_version_id→versions.id，versions.skill_id→skills.id，故 CREATE 后再 ALTER）。
-- 平台 build SQL 过滤器拒匿名代码块（视为函数级操作，2026-07-02 真机 build 实测 reject）→ 用裸 ALTER。
-- 无 IF NOT EXISTS 幂等守卫也安全：桥2 按 filename 去重只跑一次；本地 conftest 每次 DROP 重建。约束名带前缀贴合过滤器。
ALTER TABLE ${table_prefix}skills ADD CONSTRAINT ${table_prefix}current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES ${table_prefix}versions(id) ON DELETE RESTRICT;

-- 本期（2026-07-02 平台定案）：插件 database 凭据直接用平台超管 dr 账号 DSN，org 表 + 桥2 表一根连接全通，
-- 零 GRANT、零角色管理（不建 felag_platform）。dr 本就能读写自有表，故此处不写任何 GRANT。
-- ⚠️ 平台 build 时 SQL 过滤（已实现）：migration 只能建/改以 ${table_prefix} 开头的对象；可内联外键引用 org 表
-- （如 dept_id BIGINT REFERENCES departments(id)）；禁 GRANT/REVOKE、碰原生表、CREATE FUNCTION/TYPE/TRIGGER/
-- EXTENSION、COPY、ALTER SYSTEM —— 否则 build failed（日志含 pluginmigrate: reject ...）。详见平台指南 §③。
