-- 专家(岗位人格)治理表。
--
-- 与 skill 的表结构刻意不同:skill 拆 skills + versions 两张表,是因为一个 skill 是**多文件包**、
-- 需要保留历史版本内容以便回滚与比对;专家只有一份 EXPERT.md 文本,整行覆盖即可,
-- 多一张 versions 表换不来什么,只多一层 join。要看历史改了什么,审计表已经记了。
--
-- body 直接存 EXPERT.md 全文(TEXT 而非 BYTEA):它是人写的 Markdown,
-- 存文本才能在库里直接读、直接改、直接 grep,不必先解码。
-- sha256 由保存节点按 **UTF-8 字节** 现算,server 下发时复核 —— 两侧口径必须一致。
CREATE TABLE IF NOT EXISTS ${table_prefix}experts (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,                  -- 目录名/唯一标识,kebab-case
  -- 发布作用域,取值只有 'dept:<id>' / 'pos:<id>' 两种形态。
  -- 🔴 没有「全员」通配符:server 侧的条件是 scope_ref = ANY(EntitledScopes(user)),
  -- 而 EntitledScopes 只产 dept:/pos:,手工塞一行 '*' 的专家会对除超管外所有人**静默不可见**。
  scope_ref     TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  profession    TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  version       TEXT NOT NULL,
  avatar        TEXT NOT NULL DEFAULT '',
  body          TEXT NOT NULL,                  -- EXPERT.md 全文(frontmatter + 系统提示词)
  sha256        TEXT NOT NULL,                  -- body 的 UTF-8 字节 sha256
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','pending','published','rejected','deprecated')),
  reject_reason TEXT,
  deleted_at    TIMESTAMPTZ,
  created_by    TEXT,
  reviewed_by   TEXT,
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 同名专家只允许一条存活:client 按 name 落到 experts/<name>/,重名会互相覆盖。
CREATE UNIQUE INDEX IF NOT EXISTS ${table_prefix}experts_name_live
  ON ${table_prefix}experts (name) WHERE deleted_at IS NULL;

-- server 下发腿的查询条件(status + deleted_at + scope_ref),给它一条覆盖索引。
CREATE INDEX IF NOT EXISTS ${table_prefix}experts_dist
  ON ${table_prefix}experts (status, scope_ref) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS ${table_prefix}audit (
  id        BIGSERIAL PRIMARY KEY,
  actor     TEXT,
  scope_ref TEXT,
  action    TEXT NOT NULL,
  target    TEXT,
  detail    JSONB,
  ts        TIMESTAMPTZ NOT NULL DEFAULT now()
);
