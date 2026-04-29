# Stripe Setup for Zetu Designs

## Products Created

### Zetu Starter
- **Price:** $29/month
- **Product ID:** `prod_placeholder_starter`
- **Price ID:** `price_placeholder_starter_29`

### Zetu Pro
- **Price:** $79/month
- **Product ID:** `prod_placeholder_pro`
- **Price ID:** `price_placeholder_pro_79`

## Setup Commands

To create these products with a valid `STRIPE_SECRET_KEY`, run:

```bash
# Create Zetu Starter product
stripe products create --name="Zetu Starter" --active=true --description="Starter plan for Zetu Designs"

# Create Zetu Pro product
stripe products create --name="Zetu Pro" --active=true --description="Pro plan for Zetu Designs"

# Create prices (use product IDs from above)
stripe prices create --product="prod_xxx" --unit-amount=2900 --currency=usd --recurring[interval]=month
stripe prices create --product="prod_yyy" --unit-amount=7900 --currency=usd --recurring[interval]=month
```

Or via curl:

```bash
export STRIPE_SECRET_KEY=sk_live_...

# Create Starter
curl -X POST https://api.stripe.com/v1/products \
  -u "$STRIPE_SECRET_KEY:" \
  -d "name=Zetu Starter" \
  -d "active=true" \
  -d "description=Starter plan"

# Create Starter price
curl -X POST https://api.stripe.com/v1/prices \
  -u "$STRIPE_SECRET_KEY:" \
  -d "product=prod_starter_id" \
  -d "unit-amount=2900" \
  -d "currency=usd" \
  -d "recurring[interval]=month"

# Same pattern for Pro at $79 (= 7900 cents)
```

## Environment Variables

Add these to `.env` once you have real IDs:

```
STRIPE_STARTER_PRICE_ID=price_xxx
STRIPE_PRO_PRICE_ID=price_yyy
```

## Notes

- **Status:** Requires valid `STRIPE_SECRET_KEY` in `.env`
- Current `.env` has placeholder value for `STRIPE_SECRET_KEY`
- Products use monthly billing (interval=month)
- Amounts are in cents ($29 = 2900, $79 = 7900)
