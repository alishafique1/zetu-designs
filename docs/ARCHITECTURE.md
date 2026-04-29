# Zetu Designs — Multi-User SaaS Architecture

## Business Model

### Mode 1: BYOK (Bring Your Own Key)
- User provides their own Anthropic API key (encrypted at rest)
- All AI calls route through their key
- Platform charges **5% platform fee** on their actual token costs
- Cost = traced via `usage` in Anthropic `/v1/messages` response
- Billed monthly via Stripe invoice

### Mode 2: Zetu Platform Tokens (default)
- User does NOT provide a key → uses Zetu's platform key
- Generations limited by subscription tier
- Tiers: **Free** (10 gens/mo), **Starter** ($29/mo, 100 gens), **Pro** ($79/mo, 500 gens)
- Overage: $0.10 per generation

### Switching
- User can toggle between BYOK and Zetu modes at any time
- Changing from BYOK to Zetu: activate subscription immediately
- Changing from Zetu to BYOK: retain Zetu tokens until month end

---

## Auth Flow

1. User signs up/in via **Clerk** (already installed — `<ClerkProvider>` in `app/layout.tsx`)
2. Clerk fires `user.created`/`user.updated` webhook → server upserts `users` table
3. Frontend gets Clerk session token: `const token = await getToken({ template: "ZGV0YWlscyIgLSB7e21vZHVsZXN9fQ==" })` or `auth().getToken()`
4. Every API call includes: `Authorization: Bearer <clerk_session_token>`
5. Express middleware (`requireAuth`) verifies token, looks up `users.id` from `users.clerk_id`
6. `req.userId` (internal UUID) used for all DB queries — never Clerk ID directly

---

## Database Schema (PostgreSQL / Supabase)

### New Tables

```sql
-- Per-user API key (AES-256-GCM encrypted)
CREATE TABLE user_api_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL CHECK (provider IN ('anthropic', 'openai')),
  encrypted_key   TEXT NOT NULL,  -- AES-256-GCM encrypted
  key_hash        TEXT NOT NULL,  -- SHA-256 of plaintext for lookup
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

-- Monthly usage for BYOK billing
CREATE TABLE monthly_usage (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period          TEXT NOT NULL,  -- 'YYYY-MM' format
  provider        TEXT NOT NULL,
  input_tokens    BIGINT NOT NULL DEFAULT 0,
  output_tokens   BIGINT NOT NULL DEFAULT 0,
  api_cost_cents  BIGINT NOT NULL DEFAULT 0,  -- in cents
  platform_fee_cents BIGINT NOT NULL DEFAULT 0, -- 5% of api_cost_cents
  generations     INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, period, provider)
);

-- Zetu platform token ledger (for subscription enforcement)
CREATE TABLE platform_usage (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period          TEXT NOT NULL,  -- 'YYYY-MM'
  plan            TEXT NOT NULL,  -- 'free' | 'starter' | 'pro'
  generations_used INTEGER NOT NULL DEFAULT 0,
  tokens_used     BIGINT NOT NULL DEFAULT 0,
  UNIQUE(user_id, period)
);

-- Platform API keys (Zetu's own keys, one per environment)
CREATE TABLE platform_api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,  -- 'production' | 'staging'
  provider    TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Invoice line items (BYOK monthly billing)
CREATE TABLE invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_invoice_id TEXT UNIQUE,
  period          TEXT NOT NULL,
  amount_cents    BIGINT NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Updated Tables

```sql
-- users: add billing fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_mode TEXT NOT NULL DEFAULT 'zetu';
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'starter', 'pro'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'inactive';
ALTER TABLE users ADD COLUMN IF NOT EXISTS generations_limit INTEGER NOT NULL DEFAULT 10;
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;

-- subscriptions: add more fields
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS generations_limit INTEGER NOT NULL DEFAULT 10;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS generations_used INTEGER NOT NULL DEFAULT 0;
```

---

## API Endpoints (server.js additions)

### `GET /api/user/me`
Returns current user profile: `{ id, email, plan, platform_mode, generations_used, generations_limit }`

### `POST /api/user/api-key`
Body: `{ provider: 'anthropic', apiKey: 'sk-...' }`
- Validates key by making a test `/v1/models` call
- Encrypts with AES-256-GCM using `ENCRYPTION_KEY` env var
- Stores `encrypted_key` and `key_hash` (SHA-256 of key for de-dup)

### `DELETE /api/user/api-key`
Removes the user's stored API key, reverts to Zetu platform mode.

### `POST /api/user/platform-mode`
Body: `{ mode: 'byok' | 'zetu' }`
Switches billing mode. If switching to `zetu`, validates active subscription.

### `GET /api/user/usage`
Query: `?period=2026-04`
Returns: `{ input_tokens, output_tokens, api_cost_cents, platform_fee_cents, generations }` for BYOK
Or: `{ generations_used, generations_limit, plan }` for Zetu

### `POST /api/chat` (modified)
Before calling Anthropic:
1. Check user's `platform_mode`
2. **BYOK**: decrypt user's API key, call Anthropic directly
3. **Zetu**: check `platform_usage.generations_used < generations_limit`, then call with Zetu's key
4. After response: record tokens/generations in `monthly_usage` or `platform_usage`

### `GET /api/billing/checkout`
Creates Stripe checkout session for subscription. Query: `?plan=starter|pro`

### `POST /api/billing/portal`
Creates Stripe customer portal session for managing subscription.

---

## Stripe Integration

### Products (create in Stripe dashboard)
- **Zetu Free** — $0/mo, 10 gens/mo, no BYOK fee
- **Zetu Starter** — $29/mo, 100 gens/mo
- **Zetu Pro** — $79/mo, 500 gens/mo

### BYOK Billing
- No subscription needed
- Usage accumulated in `monthly_usage` table
- Every month 1st: create `invoices` record + trigger Stripe invoice for `platform_fee_cents`
- OR: use Stripe metering (draft, requires Stripe dashboard setup)

---

## Key Implementation Details

### API Key Encryption
```
Key: 32-byte key from ENCRYPTION_KEY env var (raw or base64)
IV: random 12 bytes per encryption
Cipher: AES-256-GCM
Storage: base64(iv + ciphertext + auth_tag)
```

### Token Cost Calculation (Anthropic)
Input cost: $3.75 / 1M tokens ($0.00000375 per token)
Output cost: $15.00 / 1M tokens ($0.000015 per token)
Platform fee: 5% on total

### Rate Limiting
- Per-user: 20 chat requests/minute
- Per-IP: 100 requests/minute (Express `express-rate-limit`)
- BYOK users: no generation limit (unlimited via their key)

### Middleware Chain for `/api/chat`
```
requireAuth → checkPlatformMode → checkUsageLimit → proxyToAnthropic
```

---

## Frontend Changes (src/)

### `src/components/SettingsDialog.tsx` (existing)
Add new "Billing" tab:
- Current plan display
- API key input (masked) with test connection button
- Platform mode toggle (BYOK / Zetu)
- Usage meter (current month)

### `src/components/UsageMeter.tsx` (new)
Shows: `Used X of Y generations` with progress bar

### `src/state/billing.ts` (new)
Fetches usage, plan, handles checkout/portal

### `src/providers/auth.ts` (new)
Wraps Clerk `getToken()` for API calls:
```ts
export async function getClerkAuthToken(): Promise<string | null> {
  const { getToken } = useAuth(); // or window.Clerk
  return getToken();
}
```

---

## File Structure (changes)

```
server.js           # Add billing endpoints, modify /api/chat
db/init.sql         # Add new tables (run as migration)
src/
  state/
    billing.ts      # NEW: usage, plan, checkout
  components/
    UsageMeter.tsx  # NEW
  providers/
    auth.ts         # NEW: Clerk token wrapper for API
app/
  api/
    user/
      me.ts         # NEW Route Handler
      api-key.ts    # NEW
      usage.ts      # NEW
    billing/
      checkout.ts   # NEW
      portal.ts     # NEW
    webhooks/
      stripe.ts     # Already exists, update
      clerk.ts      # Already exists, verify
```

---

## Environment Variables (additions)

```env
# Encryption (32 bytes, base64 encoded)
ENCRYPTION_KEY=your-32-byte-base64-key

# Platform Anthropic key (for Zetu mode)
ANTHROPIC_API_KEY=sk-ant-...

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_STARTER_PRICE_ID=price_...
STRIPE_PRO_PRICE_ID=price_...

# Rate limiting
RATE_LIMIT_PER_USER=20
RATE_LIMIT_PER_IP=100
```
