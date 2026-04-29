# Environment Variables Setup

This document describes all required environment variables for the project.

## Authentication

### Clerk Authentication
| Variable | Purpose | How to Get |
|----------|---------|------------|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Public key for Clerk frontend integration | Clerk Dashboard → API Keys → Copy publishable key |
| `CLERK_SECRET_KEY` | Secret key for Clerk backend operations | Clerk Dashboard → API Keys → Copy secret key |
| `CLERK_WEBHOOK_SECRET` | Verifies webhook signatures from Clerk | Clerk Dashboard → Webhooks → Copy webhook secret |

### Internal API
| Variable | Purpose | How to Get |
|----------|---------|------------|
| `INTERNAL_API_KEY` | Authenticates internal service-to-service calls | Generate a secure random string (e.g., `openssl rand -hex 32`) |

## Application

| Variable | Purpose | How to Get |
|----------|---------|------------|
| `NEXT_PUBLIC_APP_URL` | Public URL of the application | Set to `http://localhost:3000` for development |
| `ENCRYPTION_KEY` | Key for encrypting sensitive data at rest | Generate with `openssl rand -base64 32` |

## Database

| Variable | Purpose | How to Get |
|----------|---------|------------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:password@host:5432/database` |
| `POSTGRES_PASSWORD` | PostgreSQL database password | Set during Postgres installation or in config |

## External Services

### Anthropic (AI)
| Variable | Purpose | How to Get |
|----------|---------|------------|
| `ANTHROPIC_API_KEY` | API key for Anthropic Claude API | Console.anthropic.com → API Keys → Create key |

### Stripe (Payments)
| Variable | Purpose | How to Get |
|----------|---------|------------|
| `STRIPE_SECRET_KEY` | Stripe API secret key | Stripe Dashboard → Developers → API keys |
| `STRIPE_STARTER_PRICE_ID` | Price ID for starter subscription plan | Stripe Dashboard → Products → Copy price ID |
| `STRIPE_WEBHOOK_SECRET` | Verifies Stripe webhook signatures | Stripe Dashboard → Webhooks → Copy signing secret |

### Supabase (Optional)
| Variable | Purpose | How to Get |
|----------|---------|------------|
| `SUPABASE_SERVICE_KEY` | Supabase service role key | Supabase Dashboard → Project Settings → API → service_role key |

## Quick Setup

Generate all needed keys:

```bash
# Generate ENCRYPTION_KEY
openssl rand -base64 32

# Generate INTERNAL_API_KEY
openssl rand -hex 32
```

## Verification

After setting up, verify your `.env` file contains all required variables by checking for any missing values (empty strings after the `=` sign).
