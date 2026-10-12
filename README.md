## `.env` file

Create a `.env` file in the project root with these values:

```env
# Database
POSTGRES_USER=(your database user)
POSTGRES_PASSWORD=(your database password)
POSTGRES_DB=(your database name)

# Login
JWT_SECRET=(a long random string)

# pgAdmin
PGADMIN_EMAIL=(your pgAdmin login email)
PGADMIN_PASSWORD=(your pgAdmin password)

# Website
APP_URL=http://localhost:5180

# Stripe — cards, PromptPay
STRIPE_SECRET_KEY=(sk_test_... from the Stripe Dashboard)
STRIPE_WEBHOOK_SECRET=(whsec_... from: docker compose run --rm stripe-cli "stripe listen --print-secret")

# Opn Payments (Omise) — TrueMoney, ShopeePay, LINE Pay, mobile banking, Alipay
OMISE_SECRET_KEY=(skey_test_... from the Omise Dashboard)

# PayPal
PAYPAL_CLIENT_ID=(Client ID from PayPal Developer)
PAYPAL_CLIENT_SECRET=(Secret from PayPal Developer)
PAYPAL_ENV=sandbox
```

## Icons

- [Google Material Symbols](https://fonts.google.com/icons) — general UI icons
- [Font Awesome Free](https://fontawesome.com/search?ic=free-collection) — Visa, Mastercard, JCB, PayPal, LINE and Alipay logos
