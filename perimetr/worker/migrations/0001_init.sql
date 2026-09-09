-- «Периметр» — начальная схема (ТЗ §7).
-- Механизм миграций заводится на Этапе 0, пока таблиц семь, а не на Этапе 3,
-- когда в них данные (§4.3.4 — twin заплатил за это разовой миграцией всей базы).

CREATE TABLE IF NOT EXISTS users (
  id                     TEXT PRIMARY KEY,
  google_sub             TEXT UNIQUE NOT NULL,
  email                  TEXT NOT NULL,
  name                   TEXT,
  refresh_token_enc      BLOB,
  google_reauth_required INTEGER NOT NULL DEFAULT 0,
  spreadsheet_id         TEXT,
  created_at             TEXT NOT NULL,
  last_seen_at           TEXT
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  resume_text       TEXT NOT NULL DEFAULT '',
  extras_text       TEXT NOT NULL DEFAULT '',
  perimeter         TEXT NOT NULL DEFAULT '',
  industries        TEXT NOT NULL DEFAULT '',
  exclude           TEXT NOT NULL DEFAULT '',
  geo               TEXT NOT NULL DEFAULT '',
  breadth           TEXT NOT NULL DEFAULT 'medium',
  languages         TEXT NOT NULL DEFAULT '[]',
  work_auth         TEXT NOT NULL DEFAULT '[]',
  relocation        TEXT NOT NULL DEFAULT '',
  scale             TEXT NOT NULL DEFAULT '',
  years_exp         INTEGER,
  gaps              TEXT NOT NULL DEFAULT '[]',
  roles             TEXT NOT NULL DEFAULT '[]',
  salary_range      TEXT NOT NULL DEFAULT '',
  linkedin_url      TEXT NOT NULL DEFAULT '',
  linkedin_complete INTEGER NOT NULL DEFAULT 0,
  photo_policy      TEXT NOT NULL DEFAULT 'auto',
  audit             TEXT NOT NULL DEFAULT '',
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS facts (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company      TEXT,
  role_title   TEXT,
  period_from  TEXT,
  period_to    TEXT,
  action       TEXT NOT NULL,
  how          TEXT,
  result       TEXT,
  metric_value REAL,
  metric_unit  TEXT,
  scale_tags   TEXT NOT NULL DEFAULT '[]',
  domain_tags  TEXT NOT NULL DEFAULT '[]',
  quantified   INTEGER NOT NULL DEFAULT 0,
  source_hint  TEXT NOT NULL,
  confirmed    INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_facts_user ON facts(user_id, confirmed, quantified DESC);

CREATE TABLE IF NOT EXISTS opportunities (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company       TEXT NOT NULL,
  company_key   TEXT NOT NULL,
  industry      TEXT, city TEXT, country TEXT, size TEXT, website TEXT,
  kind          TEXT NOT NULL CHECK (kind IN ('vacancy','hypothesis')),
  origin        TEXT NOT NULL DEFAULT 'discovered',
  jd_text       TEXT,
  jd_fetched_at TEXT,
  role_title    TEXT NOT NULL,
  signal        TEXT,
  source_url    TEXT,
  source_date   TEXT,
  status        TEXT NOT NULL DEFAULT 'new',
  score         INTEGER,
  hard_blocker  TEXT,
  channel       TEXT NOT NULL DEFAULT 'cold',
  referral_name TEXT,
  salary_hint   TEXT,
  contact_name  TEXT, contact_title TEXT, contact_email TEXT, contact_linkedin TEXT,
  user_note     TEXT,
  sheet_row     INTEGER,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (user_id, company_key, role_title)
);
CREATE INDEX IF NOT EXISTS idx_opp_user_status ON opportunities(user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS analyses (
  opportunity_id TEXT PRIMARY KEY REFERENCES opportunities(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL,
  expectations   TEXT NOT NULL,
  uvp            TEXT NOT NULL,
  objection      TEXT,
  blockers       TEXT,
  soft_gaps      TEXT,
  demand         TEXT,            -- требования места: снятие блокера без вызова модели (§3.3)
  reconstructed  INTEGER NOT NULL DEFAULT 0,
  model          TEXT NOT NULL,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id             TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('resume','letter')),
  version        INTEGER NOT NULL DEFAULT 1,
  subject        TEXT,
  body           TEXT NOT NULL,
  edited_by_user INTEGER NOT NULL DEFAULT 0,
  format_variant TEXT,
  facts_used     TEXT,
  checks         TEXT,
  model          TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_doc_opp ON documents(opportunity_id, kind, version DESC);

CREATE TABLE IF NOT EXISTS runs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state       TEXT NOT NULL,
  stage       TEXT,
  found       INTEGER NOT NULL DEFAULT 0,
  added       INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  cost_usd    REAL NOT NULL DEFAULT 0,
  started_at  TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_user ON runs(user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS usage_log (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  operation  TEXT NOT NULL,
  model      TEXT NOT NULL,
  tokens_in  INTEGER, tokens_out INTEGER, tool_calls INTEGER,
  cost_usd   REAL NOT NULL DEFAULT 0,
  -- §4.3.2 — неудачные вызовы пишутся тоже, иначе «$0» означает и «дёшево»,
  -- и «ничего не работает».
  ok         INTEGER NOT NULL DEFAULT 1,
  error      TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_log(user_id, created_at DESC);

-- Конфиг (§10.1 в редакции 1.2): дефолты в коде, переопределения здесь.
CREATE TABLE IF NOT EXISTS config (
  key        TEXT PRIMARY KEY,   -- MODELS | THRESHOLDS | STOPLIST | PROMPTS
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
