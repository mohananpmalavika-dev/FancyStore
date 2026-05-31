# The Golden Crown

Simple Node.js Express API scaffold for The Golden Crown managing jewellery, cosmetics, gift items, ornaments, and premium styles.

Getting started

1. Install dependencies:

```bash
npm install
```

2. Run in development (requires `nodemon`):

```bash
npm run dev
```

3. Start production:

```bash
npm start
```

API endpoints

- `GET /products` - list products
- `GET /products/:id` - get product
- `POST /products` - create product
- `PUT /products/:id` - update product
- `DELETE /products/:id` - delete product

Authentication

- `POST /auth/register` - register user (body: `username`, `password`, `role`)
- `POST /auth/login` - login (body: `username`, `password`) returns `token`

Protected routes

- Create/update/delete products require an `Authorization: Bearer <token>` header and `admin` role.
- `POST /products/:id/add-stock` requires `admin` or `stock_manager` role (body: `amount`).

Admin UI

- Visit `/admin` for a minimal admin UI and links.

Environment

Create a `.env` file from `.env.example` and set `JWT_SECRET`, SMTP settings and `ADMIN_EMAIL`.

Email

- When a product is created the server will send a notification to `ADMIN_EMAIL` using configured SMTP.

Files

- [src/index.js](src/index.js)
- [src/routes/products.js](src/routes/products.js)
- [src/controllers/productController.js](src/controllers/productController.js)
- [src/data/dataStore.js](src/data/dataStore.js)
