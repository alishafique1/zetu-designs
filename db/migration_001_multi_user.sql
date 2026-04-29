-- ============================================================
-- Migration 001: Multi-User Billing System
-- Adds platform modes (zetu/byok), BYOK API keys, usage tracking, and invoices
-- ============================================================

-- ---- Add platform_mode and generation tracking to users ----
ALTER TABLE users
  ADD COLUMN platform_mode TEXT NOT NULL DEFAULT 'zetu' CHECK (platform_mode IN ('zetu', 'byok')),
  ADD COLUMN generations_limit INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN generations_used INTEGER NOT NULL DEFAULT 0;

-- ---- Per-user encrypted API keys (AES-256-GCM) ----
CREATE TABLE user_api_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL CHECK (provider IN ('anthropic', 'openai')),
  key_fingerprint TEXT NOT NULL,  -- SHA-256 of key for de-dup lookup
  encrypted_payload TEXT NOT NULL,  -- base64(iv + ciphertext + auth_tag)
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

-- ---- Monthly token usage for BYOK billing ----
CREATE TABLE monthly_usage (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period              TEXT NOT NULL,  -- 'YYYY-MM'
  provider            TEXT NOT NULL,
  input_tokens        BIGINT NOT NULL DEFAULT 0,
  output_tokens       BIGINT NOT NULL DEFAULT 0,
  api_cost_cents      BIGINT NOT NULL DEFAULT 0,  -- raw API cost in cents
  platform_fee_cents  BIGINT NOT NULL DEFAULT 0,   -- 5% fee in cents
  generations         INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, period, provider)
);

-- ---- Zetu platform token usage (subscription-based) ----
CREATE TABLE platform_usage (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period           TEXT NOT NULL,  -- 'YYYY-MM'
  plan             TEXT NOT NULL DEFAULT 'free',
  generations_used INTEGER NOT NULL DEFAULT 0,
  tokens_used      BIGINT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, period)
);

-- ---- Platform API keys (Zetu's own keys, one per environment) ----
CREATE TABLE platform_api_keys (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,  -- 'production', 'staging'
  provider         TEXT NOT NULL,
  encrypted_key    TEXT NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- Monthly invoices for BYOK ----
CREATE TABLE invoices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_invoice_id   TEXT UNIQUE,
  period              TEXT NOT NULL,
  amount_cents        BIGINT NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'pending',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- Indexes for new tables ----
CREATE INDEX IF NOT EXISTS user_api_keys_user_id_idx ON user_api_keys(user_id);
CREATE INDEX IF NOT EXISTS monthly_usage_user_period_idx ON monthly_usage(user_id, period DESC);
CREATE INDEX IF NOT EXISTS platform_usage_user_period_idx ON platform_usage(user_id, period DESC);
CREATE INDEX IF NOT EXISTS invoices_user_id_idx ON invoices(user_id);

-- ---- Updated at triggers for new tables ----
CREATE OR REPLACE TRIGGER user_api_keys_updated_at
  BEFORE UPDATE ON user_api_keys
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER monthly_usage_updated_at
  BEFORE UPDATE ON monthly_usage
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER platform_usage_updated_at
  BEFORE UPDATE ON platform_usage
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
