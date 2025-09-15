Food Order Backend (Render)
--------------------------
Endpoints:
 - GET  /api/health
 - GET  /api/config   -> { stripeEnabled: bool, currency: 'CHF' }
 - GET  /api/products
 - POST /api/products {name, price, image_url}
 - PATCH/DELETE /api/products/:id
 - POST /api/orders   {customer: {name,phone,address}, items: [{id,name,price,qty}], payment}
 - GET  /api/orders   (simple admin fetch)
 - GET  /api/orders/:id

 - POST /api/pay/stripe/session  (optional, requires STRIPE_SECRET_KEY)

Env vars:
 - FRONTEND_URL, ALLOWED_ORIGIN, DB_PATH, STRIPE_SECRET_KEY
