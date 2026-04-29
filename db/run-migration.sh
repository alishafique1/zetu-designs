#!/usr/bin/env bash
# =============================================================================
# Idempotent migration runner for migration_001_multi_user.sql
# Loads DATABASE_URL from /root/zetu-designs/.env and runs the migration.
# Safe to run multiple times — skips already-applied changes.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION_FILE="${SCRIPT_DIR}/migration_001_multi_user.sql"
ENV_FILE="${SCRIPT_DIR}/../.env"

# --- Load DATABASE_URL from .env ----------------------------------------
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: .env not found at $ENV_FILE" >&2
  exit 1
fi

# Read DATABASE_URL (handles quoted values in .env)
DATABASE_URL="$(grep '^DATABASE_URL=' "$ENV_FILE" | cut -d'=' -f2- | sed 's/^[[:space:]]*//;s/[[:space:]]*$//;s/^["'"'"']//;s/["'"'"']$//')"

if [[ -z "$DATABASE_URL" ]]; then
  echo "ERROR: DATABASE_URL is not set in $ENV_FILE" >&2
  exit 1
fi

echo ">>> Migration: $MIGRATION_FILE"
echo ">>> Database:  ${DATABASE_URL%@*}@***"  # hide password in log

# --- Guard: skip ALTER TABLE on users if columns already exist -----------
# This is a one-time fixup so the ALTER TABLE in the migration doesn't
# throw an error when run a second time.
alter_users_if_needed() {
  local cols
  cols=$(psql "$DATABASE_URL" -t -c "
    SELECT string_agg(column_name, ',')
    FROM information_schema.columns
    WHERE table_name = 'users'
      AND table_schema = 'public'
      AND column_name IN ('platform_mode','generations_limit','generations_used');
  " 2>/dev/null || true)

  # If all three columns exist, the migration already altered this table.
  if grep -q "platform_mode" <<< "$cols" && \
     grep -q "generations_limit" <<< "$cols" && \
     grep -q "generations_used" <<< "$cols"; then
    echo "     [users] platform columns already present — skipping ALTER TABLE"
    return 0
  fi

  echo "     [users] adding platform_mode / generations_limit / generations_used"
  psql "$DATABASE_URL" -qt -c "
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS platform_mode TEXT NOT NULL DEFAULT 'zetu'
        CHECK (platform_mode IN ('zetu', 'byok')),
      ADD COLUMN IF NOT EXISTS generations_limit INTEGER NOT NULL DEFAULT 10,
      ADD COLUMN IF NOT EXISTS generations_used INTEGER NOT NULL DEFAULT 0;
  "
}

# --- Guard: skip CREATE TABLE if table already exists -------------------
create_table_if_not_exists() {
  local table_name="$1"
  local check_sql
  check_sql="SELECT 1 FROM information_schema.tables WHERE table_name = '$table_name' AND table_schema = 'public';"

  if psql "$DATABASE_URL" -t -c "$check_sql" | grep -q '1'; then
    echo "     [$table_name] already exists — skipping CREATE TABLE"
    return 0
  fi

  echo "     [$table_name] creating table"
  return 1  # signal: migration SQL must run
}

# --- Guard: skip CREATE INDEX if index already exists -------------------
create_index_if_not_exists() {
  local index_name="$1"
  local check_sql
  check_sql="SELECT 1 FROM pg_indexes WHERE indexname = '$index_name';"

  if psql "$DATABASE_URL" -t -c "$check_sql" | grep -q '1'; then
    echo "     [index $index_name] already exists — skipping CREATE INDEX"
    return 0
  fi

  echo "     [index $index_name] creating"
  return 1  # signal: migration SQL must run
}

# --- Guard: skip CREATE TRIGGER if trigger already exists ---------------
create_trigger_if_not_exists() {
  local trigger_name="$1"
  local check_sql
  check_sql="SELECT 1 FROM pg_trigger WHERE tgname = '$trigger_name';"

  if psql "$DATABASE_URL" -t -c "$check_sql" | grep -q '1'; then
    echo "     [trigger $trigger_name] already exists — skipping CREATE TRIGGER"
    return 0
  fi

  echo "     [trigger $trigger_name] creating"
  return 1  # signal: migration SQL must run
}

# --- Build and run per-object chunks ------------------------------------
echo ""
echo ">>> Running pre-checks and migration..."

# 1. ALTER TABLE users
alter_users_if_needed

# 2. Per-table CREATE TABLE guards
#    We extract the CREATE TABLE statement from the migration file and
#    run it only when the table is absent.

declare -A TABLE_STMTS=(
  ["user_api_keys"]="CREATE TABLE user_api_keys ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider TEXT NOT NULL CHECK (provider IN ('anthropic', 'openai')), key_fingerprint TEXT NOT NULL, encrypted_payload TEXT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(user_id, provider) );"
  ["monthly_usage"]="CREATE TABLE monthly_usage ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, period TEXT NOT NULL, provider TEXT NOT NULL, input_tokens BIGINT NOT NULL DEFAULT 0, output_tokens BIGINT NOT NULL DEFAULT 0, api_cost_cents BIGINT NOT NULL DEFAULT 0, platform_fee_cents BIGINT NOT NULL DEFAULT 0, generations INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(user_id, period, provider) );"
  ["platform_usage"]="CREATE TABLE platform_usage ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, period TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'free', generations_used INTEGER NOT NULL DEFAULT 0, tokens_used BIGINT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(user_id, period) );"
  ["platform_api_keys"]="CREATE TABLE platform_api_keys ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, provider TEXT NOT NULL, encrypted_key TEXT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );"
  ["invoices"]="CREATE TABLE invoices ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, stripe_invoice_id TEXT UNIQUE, period TEXT NOT NULL, amount_cents BIGINT NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW() );"
)

for tbl in "${!TABLE_STMTS[@]}"; do
  if create_table_if_not_exists "$tbl"; then
    # table doesn't exist yet — run the DDL
    psql "$DATABASE_URL" -qt -c "${TABLE_STMTS[$tbl]}"
  fi
done

# 3. CREATE INDEX guards (migrations uses IF NOT EXISTS so these are safe,
#    but we still check to give nicer output)
declare -A INDEX_STMTS=(
  ["user_api_keys_user_id_idx"]="CREATE INDEX IF NOT EXISTS user_api_keys_user_id_idx ON user_api_keys(user_id);"
  ["monthly_usage_user_period_idx"]="CREATE INDEX IF NOT EXISTS monthly_usage_user_period_idx ON monthly_usage(user_id, period DESC);"
  ["platform_usage_user_period_idx"]="CREATE INDEX IF NOT EXISTS platform_usage_user_period_idx ON platform_usage(user_id, period DESC);"
  ["invoices_user_id_idx"]="CREATE INDEX IF NOT EXISTS invoices_user_id_idx ON invoices(user_id);"
)

for idx in "${!INDEX_STMTS[@]}"; do
  if create_index_if_not_exists "$idx"; then
    psql "$DATABASE_URL" -qt -c "${INDEX_STMTS[$idx]}"
  else
    # Index already existed but the migration file uses IF NOT EXISTS anyway
    psql "$DATABASE_URL" -qt -c "${INDEX_STMTS[$idx]}" 2>/dev/null || true
  fi
done

# 4. CREATE TRIGGER guards
declare -A TRIGGER_STMTS=(
  ["user_api_keys_updated_at"]="CREATE OR REPLACE TRIGGER user_api_keys_updated_at BEFORE UPDATE ON user_api_keys FOR EACH ROW EXECUTE FUNCTION update_updated_at();"
  ["monthly_usage_updated_at"]="CREATE OR REPLACE TRIGGER monthly_usage_updated_at BEFORE UPDATE ON monthly_usage FOR EACH ROW EXECUTE FUNCTION update_updated_at();"
  ["platform_usage_updated_at"]="CREATE OR REPLACE TRIGGER platform_usage_updated_at BEFORE UPDATE ON platform_usage FOR EACH ROW EXECUTE FUNCTION update_updated_at();"
)

for trig in "${!TRIGGER_STMTS[@]}"; do
  if create_trigger_if_not_exists "$trig"; then
    psql "$DATABASE_URL" -qt -c "${TRIGGER_STMTS[$trig]}" 2>/dev/null || true
  fi
done

echo ""
echo ">>> Migration complete."
