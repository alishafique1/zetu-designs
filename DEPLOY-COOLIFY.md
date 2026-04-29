# Deploying Social Dots Design Studio on Coolify (VPS)

## Architecture

```
Coolify (your VPS)
  └── Coolify-managed PostgreSQL 16 container
  └── social-dots-studio-app container (this repo)
         └── Express API (port 3000)
         └── Vite static build (served by Express)
```

## Prerequisites

- A VPS with Coolify installed
- Domain / subdomain pointed to your VPS IP
- Docker and Docker Compose available on the host

---

## Step 1 — Add PostgreSQL Database

1. In Coolify dashboard → **Databases** → **Add Database**
2. Choose **PostgreSQL 16**
3. Set database name: `social_dots_studio`
4. Set username: `studio_user`
5. Copy the **Connection URL** — you'll need it for Step 2
6. Coolify will expose it on a random port (e.g. `5433`)

---

## Step 2 — Fork / Clone the Repo to Coolify

1. Fork this repo to your GitHub
2. In Coolify → **Applications** → **New Application**
3. Connect your GitHub repo
4. Branch: `main`

---

## Step 3 — Configure Environment Variables

In Coolify → your app → **Environment Variables**, add:

```
# Database (use the Connection URL from Step 1)
DATABASE_URL=postgresql://studio_user:YOUR_PASSWORD@YOUR_VPS_IP:5433/social_dots_studio
SUPABASE_SERVICE_KEY=   # same as DATABASE_URL without the host/port/db prefix, or a service role key

# AI
ANTHROPIC_API_KEY=sk-ant-...

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_STARTER_PRICE_ID=price_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Clerk
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_WEBHOOK_SECRET=whsec_...

# Internal
INTERNAL_API_KEY=a-long-random-string-you-generate

# App
NEXT_PUBLIC_APP_URL=https://your-domain.com
PORT=3000
NODE_ENV=production
```

---

## Step 4 — Set Build Settings

In Coolify → **Settings**:

- **Build Pack**: `Dockerfile`
- **Dockerfile Location**: `Dockerfile`
- **Publish Port**: `3000`

---

## Step 5 — Init the Database Schema

The `db/init.sql` file runs automatically on first boot via docker-compose's init volume.

To manually run it:
```bash
docker exec -i social-dots-studio-db psql -U studio_user -d social_dots_studio < db/init.sql
```

---

## Step 6 — Domains

Add your domain in Coolify → **Domains**:
- `studio.yourdomain.com` → points to port `3000`

---

## Step 7 — Stripe Webhook (one-time setup)

```bash
stripe listen --forward-to your-domain.com/api/webhooks/stripe
```

Copy the webhook signing secret (`whsec_...`) into your `STRIPE_WEBHOOK_SECRET` env var.

---

## Step 8 — Clerk Webhook

In Clerk Dashboard → Webhooks → Add Endpoint:
- URL: `https://your-domain.com/api/webhooks/clerk`
- Subscribe to: `user.created`, `user.updated`, `user.deleted`

Copy the signing secret to `CLERK_WEBHOOK_SECRET`.

---

## Updating

Push to `main` → Coolify auto-deploys via webhook.

---

## Docker Compose (manual deploy without Coolify)

```bash
# Copy and fill in env
cp .env.example .env

# Start
docker compose up -d --build

# Check logs
docker compose logs -f app

# Stop
docker compose down
```

---

## Troubleshooting

**Container won't start:**
- Check `docker compose logs app` — usually a missing env var
- Verify DATABASE_URL is reachable from inside the container

**Build fails:**
- Ensure `node_modules` is NOT in the Docker build context (add `.dockerignore`)
- Verify pnpm lockfile matches the lockfile in the repo

**No static assets:**
- The `dist/` folder is built during `docker build` via `pnpm build`
- If `dist/` is missing after deploy, check the build logs
