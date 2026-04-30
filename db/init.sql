-- ============================================================
-- Social Dots Design Studio — PostgreSQL Schema
-- Run once on first boot via docker-compose init volume
-- ============================================================

-- ---- Extensions ----
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---- Users (synced from Clerk) ----
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id      TEXT UNIQUE NOT NULL,
  email         TEXT,
  display_name  TEXT,
  avatar_url    TEXT,
  plan          TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'starter', 'pro')),
  stripe_customer_id  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_clerk_id_idx ON users(clerk_id);
CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);

-- ---- Brands ----
CREATE TABLE IF NOT EXISTS brands (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  slug             TEXT NOT NULL,
  primary_color    TEXT NOT NULL DEFAULT '#2D74FF',
  secondary_color  TEXT NOT NULL DEFAULT '#E67E22',
  accent_color     TEXT NOT NULL DEFAULT '#1A1A2E',
  background_color TEXT NOT NULL DEFAULT '#FFFFFF',
  text_color       TEXT NOT NULL DEFAULT '#1A1A2E',
  font_primary     TEXT NOT NULL DEFAULT 'Inter',
  font_secondary   TEXT NOT NULL DEFAULT 'Inter',
  logo_url         TEXT,
  tagline          TEXT,
  is_default       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS brands_user_id_idx ON brands(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS brands_user_default_idx ON brands(user_id) WHERE is_default = TRUE;

-- ---- Projects ----
CREATE TABLE IF NOT EXISTS projects (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand_id            UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  skill_id            TEXT,
  prompt              TEXT,
  visual_direction    TEXT,
  generated_html      TEXT,
  design_system_id    TEXT,
  status              TEXT NOT NULL DEFAULT 'draft'
                                     CHECK (status IN ('draft', 'generating', 'done', 'failed')),
  generations_count   INTEGER NOT NULL DEFAULT 0,
  generations_limit   INTEGER NOT NULL DEFAULT 5,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS projects_user_id_idx ON projects(user_id);
CREATE INDEX IF NOT EXISTS projects_brand_id_idx ON projects(brand_id);
CREATE INDEX IF NOT EXISTS projects_status_idx ON projects(status);

-- ---- Templates ----
CREATE TABLE IF NOT EXISTS templates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT,
  source_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  files_json       JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS templates_user_id_idx ON templates(user_id);
CREATE INDEX IF NOT EXISTS templates_source_project_id_idx ON templates(source_project_id);

-- ---- Subscriptions ----
CREATE TABLE IF NOT EXISTS subscriptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_subscription_id  TEXT UNIQUE NOT NULL,
  stripe_customer_id      TEXT NOT NULL,
  stripe_price_id         TEXT,
  plan                    TEXT NOT NULL DEFAULT 'starter' CHECK (plan IN ('starter', 'pro')),
  status                  TEXT NOT NULL DEFAULT 'active'
                                          CHECK (status IN ('active', 'trialing', 'past_due', 'canceled', 'unpaid')),
  current_period_start    TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  cancel_at_period_end    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS subscriptions_customer_idx ON subscriptions(stripe_customer_id);

-- ---- Generation logs ----
CREATE TABLE IF NOT EXISTS generation_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  brand_id        UUID REFERENCES brands(id) ON DELETE SET NULL,
  skill_id        TEXT,
  tokens_used     INTEGER,
  generation_ms    INTEGER,
  status          TEXT NOT NULL CHECK (status IN ('success', 'error')),
  error_message   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS generation_logs_user_idx ON generation_logs(user_id);
CREATE INDEX IF NOT EXISTS generation_logs_created_idx ON generation_logs(created_at DESC);

-- ---- Updated at trigger ----
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER brands_updated_at
  BEFORE UPDATE ON brands
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
