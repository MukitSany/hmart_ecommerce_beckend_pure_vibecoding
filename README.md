# Hmart Backend (Express + MongoDB + SSLCommerz)

REST API for the Hmart store. The Next.js frontend lives in the separate `hmart-frontend` folder.

## Run

```bash
npm install
cp .env.example .env     # then edit values
npm run seed             # demo categories, products, banners, coupons, 3 users
npm run dev              # http://localhost:5000
```

Requires Node 18+ and a MongoDB server (local, or an Atlas connection string in `MONGO_URI`).

## Demo logins (after `npm run seed`)

| Role         | Email              | Password      |
|--------------|--------------------|---------------|
| Admin        | admin@hmart.com    | Admin@123     |
| Merchandiser | merch@hmart.com    | Merch@123     |
| Customer     | customer@hmart.com | Customer@123  |

Change these immediately outside local development.

## Roles

- **customer**: browse, cart, checkout, orders, wishlist, reviews, addresses. Self-registration always creates this role.
- **merchandiser**: `/api/merchandiser/*`, gated by per-user permissions `catalog`, `inventory`, `orders`, `marketing` (an admin toggles them).
  - Catalog management: products and categories
  - Inventory control: stock adjustments, low-stock view
  - Order fulfillment: status flow, courier and tracking
  - Marketing: coupons, hero/promo/featured banners
- **admin**: `/api/admin/*` plus everything a merchandiser can do.
  - Integrations (SSLCommerz, SMTP, SMS, analytics)
  - Site configuration (branding, shipping, tax, COD, registration)
  - Security & permissions (users, roles, password reset, audit log)
  - Maintenance (maintenance mode, stale-order cleanup, log purge, reindex, health)

## SSLCommerz payment flow

1. Customer checks out: `POST /api/customer/orders`. The server prices the cart itself (never trusts client prices), reserves stock, creates the order with a unique `tranId`, then calls SSLCommerz `gwprocess/v4` and returns `paymentUrl`.
2. The browser is redirected to SSLCommerz.
3. SSLCommerz POSTs to `/api/payment/success|fail|cancel` (and `/api/payment/ipn` server-to-server).
4. On success the server calls SSLCommerz's **validation API** and checks status, `tran_id` and amount before marking the order paid. A failed, cancelled or invalid payment cancels the order and returns the stock.
5. The server redirects to `CLIENT_URL/checkout/success|fail|cancel`.

Setup:
- Get sandbox credentials at https://developer.sslcommerz.com/registration/ and put them in `.env` (or enter them in Admin → Integrations; values saved there take priority).
- `SERVER_URL` must be **publicly reachable** because SSLCommerz calls it. For local testing, expose the API with a tunnel (e.g. ngrok) and set `SERVER_URL` to that URL.
- Set `SSLCOMMERZ_IS_LIVE=true` only with live credentials.
- Currency defaults to BDT. Other currencies need to be enabled on your SSLCommerz account.

## Notes

- All config is in `.env`. `JWT_SECRET` is required.
- Login and register are rate-limited. Helmet and CORS (`CLIENT_URL`) are enabled.
- Staff actions are written to the audit log (Admin → Security).
