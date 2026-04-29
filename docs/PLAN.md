# Zetu Designs — Launch Plan

## Status: Pre-launch (credential/configuration gaps remain)

---

## Business Model

| Mode | How it works | Revenue |
|---|---|---|
| **BYOK** | User provides own Anthropic key; 5% platform fee on token costs | Variable |
| **Zetu Tokens** | Use platform key; tiers: Free (10/mo), Starter ($29/100/mo), Pro ($79/500/mo) | Subscription |

---

## Done

### Auth — Clerk
- [x] `requireAuth` middleware: verifies Clerk JWT, looks up internal UUID from `users.clerk_id`
- [x] Clerk webhook handler: `user.created`, `user.updated`, `user.deleted` events
- [x] Frontend token wrapper: `src/providers/auth.ts` attaches `Authorization: Bearer <clerk_token>` to all API calls
- [x] `src/state/projects.ts`: all fetch calls now carry auth header
- [x] Clerk env vars: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET` in `.env`

### Payments — Stripe
- [x] Stripe checkout session flow (`/api/billing/checkout`)
- [x] Stripe billing portal (`/api/billing/portal`)
- [x] Stripe webhook handler: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
- [x] `src/state/billing.ts`: billing API calls
- [x] Graceful signature verification failure handling (returns 400, not crash)
- [x] `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` in `.env`
- [x] `docs/STRIPE_SETUP.md`: CLI commands to create products once key is available

### Database
- [x] `db/migration_001_multi_user.sql`: all billing tables + user columns
- [x] `db/run-migration.sh`: idempotent, checks objects exist before creating, executable

### API Keys (BYOK mode)
- [x] AES-256-GCM encrypt/decrypt in `server.js`
- [x] `user_api_keys` table: stores encrypted key per provider per user
- [x] `ANTHROPIC_API_KEY` env var for platform key (Zetu token mode)

### Other
- [x] `docs/ENV_SETUP.md`: all env vars documented
- [x] `docs/WEBHOOKS.md`: webhook URLs, events, local testing via `stripe listen` / ngrok
- [x] `Dockerfile` fixed: `.env`, `skills/`, `design-systems/`, `src/providers/`, `src/artifacts/` all now copied correctly
- [x] `package.json`: added missing `@supabase/supabase-js`, `stripe`, `svix`, `uuid` + installed
- [x] `server.js`: removed unused `basename` import

---

## Remaining — by priority

### 1. Add real `STRIPE_SECRET_KEY` to `.env`
The key in `.env` is a placeholder. Without it, no Stripe API calls work.

```
stripe login
stripe init  # if needed
# or get key from dashboard.stripe.com → Developers → API keys
```

Add to `.env`:
```
STRIPE_SECRET_KEY=sk_live_...
```

### 2. Create Stripe products + add Price IDs to `.env`
```bash
# After setting STRIPE_SECRET_KEY:
stripe products create --name="Zetu Starter" --active=true
stripe prices create --product=<starter_product_id> --unit-amount=2900 --currency=usd --recurring[interval]=month

stripe products create --name="Zetu Pro" --active=true
stripe prices create --product=<pro_product_id> --unit-amount=7900 --currency=usd --recurring[interval]=month
```

Add to `.env`:
```
STRIPE_STARTER_PRICE_ID=price_...
STRIPE_PRO_PRICE_ID=price_...
```

### 3. Set real `NEXT_PUBLIC_APP_URL`
Webhook URLs are derived from this.

```
NEXT_PUBLIC_APP_URL=https://your-actual-domain.com
```

### 4. Run DB migration
```bash
cd /root/zetu-designs
bash db/run-migration.sh
```

Requires `DATABASE_URL` pointing to a live Postgres instance (Supabase).

### 5. Register webhook URLs

**In Clerk dashboard** (clerk.com → your app → Webhooks):
- URL: `https://your-domain.com/api/webhooks/clerk`
- Events: `user.created`, `user.updated`, `user.deleted`

**In Stripe dashboard** (dashboard.stripe.com → Developers → Webhooks):
- URL: `https://your-domain.com/api/webhooks/stripe`
- Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`

### 6. Generate `ENCRYPTION_KEY`
Already added to `.env` (generated). Verify it exists:
```
ENCRYPTION_KEY=$(openssl rand -base64 32)
```

### 7. Push to GitHub + deploy
```bash
cd /root/zetu-designs
git add -A
git commit -m "feat: multi-user SaaS — auth, billing, migration scripts"
git push
```

Then deploy via Coolify/Docker — see `docs/DEPLOY-COOLIFY.md`.

### 8. Test end-to-end
- [ ] Sign up with Clerk → user created in DB
- [ ] Subscribe via Stripe checkout → subscription recorded
- [ ] BYOK: add API key → encrypted → used in generations
- [ ] Zetu tokens: generate → count decrements
- [ ] Webhooks fire → DB updated correctly

---

## Env vars summary

| Variable | Status | Where set |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | ✅ Set | `.env` |
| `CLERK_SECRET_KEY` | ✅ Set | `.env` |
| `CLERK_WEBHOOK_SECRET` | ✅ Set | `.env` |
| `NEXT_PUBLIC_APP_URL` | ⚠️ `http://localhost:3000` — must change to real domain | `.env` |
| `STRIPE_SECRET_KEY` | ⚠️ Placeholder — must replace with real key | `.env` |
| `STRIPE_STARTER_PRICE_ID` | ⚠️ Empty | `.env` |
| `STRIPE_PRO_PRICE_ID` | ⚠️ Empty | `.env` |
| `STRIPE_WEBHOOK_SECRET` | ✅ Set | `.env` |
| `ENCRYPTION_KEY` | ✅ Generated | `.env` |
| `DATABASE_URL` | ✅ Set | `.env` |
| `ANTHROPIC_API_KEY` | ✅ Set | `.env` |
| `POSTGRES_PASSWORD` | ✅ Set | `.env` |
| `INTERNAL_API_KEY` | ✅ Set | `.env` |
| `SUPABASE_SERVICE_KEY` | ⚠️ Verify full value | `.env` |
