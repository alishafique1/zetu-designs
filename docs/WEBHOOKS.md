# Webhooks Setup

## Webhook URLs

Register these in the respective dashboards:

| Service | URL |
|---------|-----|
| **Clerk** | ${NEXT_PUBLIC_APP_URL}/api/webhooks/clerk |
| **Stripe** | ${NEXT_PUBLIC_APP_URL}/api/webhooks/stripe |

Example (local): http://localhost:3000/api/webhooks/clerk

---

## Testing Locally

### Stripe
```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```
Copy the webhook signing secret output and set STRIPE_WEBHOOK_SECRET in .env.

### Clerk
1. Start your app: pnpm dev
2. Expose via ngrok:
   ```bash
   ngrok http 3000
   ```
3. Copy the ngrok HTTPS URL (e.g. https://abc123.ngrok.app)
4. In Clerk Dashboard -> Webhooks -> add endpoint:
   ```
   https://abc123.ngrok.app/api/webhooks/clerk
   ```
5. Subscribe to events: user.created, user.updated, user.deleted

---

## Signing Secrets

Both secrets are already defined in .env — just ensure they are populated:

| Secret | Where to Find |
|--------|---------------|
| CLERK_WEBHOOK_SECRET | Clerk Dashboard -> Webhooks -> your endpoint -> Signing Secret |
| STRIPE_WEBHOOK_SECRET | Stripe CLI output (stripe listen) or Stripe Dashboard -> Webhooks -> your endpoint |

Add to .env:
```
CLERK_WEBHOOK_SECRET=whsec_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

---

## Required Events

### Clerk
- user.created
- user.updated
- user.deleted

### Stripe
- checkout.session.completed
- customer.subscription.updated
- customer.subscription.deleted
- invoice.payment_failed
