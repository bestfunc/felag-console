CREATE TABLE IF NOT EXISTS ${table_prefix}sources (
  id          BIGSERIAL PRIMARY KEY,
  git_url     TEXT NOT NULL,
  plugin      TEXT NOT NULL,
  scope_ref   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','deprecated')),
  created_by  TEXT,
  reviewed_by TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  UNIQUE (git_url, plugin, scope_ref)
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
