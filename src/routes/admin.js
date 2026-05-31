const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const {
  attachProductImages,
  stringifyProductImages,
} = require('../utils/productImages');
const { parseProductForm } = require('../utils/productImageUploads');
const { getStoreProfile, updateStoreProfile } = require('../utils/storeProfile');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).send('Invalid input');
  next();
};

const authCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  maxAge: 8 * 60 * 60 * 1000,
};

const orderStatuses = ['new', 'accepted', 'packed', 'out_for_delivery', 'delivered', 'cancelled'];

router.get('/login', (req, res) => {
  res.render('admin_login', { title: 'Admin Login', error: null, csrfToken: res.locals.csrfToken });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = username ? db.prepare('SELECT * FROM users WHERE username = ?').get(username) : null;
  const ok = user && bcrypt.compareSync(password || '', user.password);

  if (!ok || user.role !== 'admin') {
    return res.status(401).render('admin_login', {
      title: 'Admin Login',
      error: 'Invalid admin credentials',
      csrfToken: res.locals.csrfToken,
    });
  }

  const payload = { id: user.id, username: user.username, role: user.role };
  const token = jwt.sign(payload, process.env.JWT_SECRET || 'change-me', { expiresIn: '8h' });
  res.cookie('auth_token', token, authCookieOptions);
  res.redirect('/admin');
});

router.post('/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.redirect('/admin/login');
});

// Admin product list
router.get('/', auth.authenticateJWT, auth.authorizeRole(['admin']), (req, res) => {
  const products = db.prepare('SELECT * FROM products').all().map(product => attachProductImages(product));
  const stats = {
    products: products.length,
    stock: products.reduce((total, product) => total + Number(product.stock || 0), 0),
    offers: db.prepare('SELECT COUNT(1) as count FROM offers WHERE active = 1').get().count,
    orders: db.prepare("SELECT COUNT(1) as count FROM orders WHERE status NOT IN ('delivered', 'cancelled')").get().count,
  };
  res.render('admin_products', { title: 'Admin - Products', products, stats, csrfToken: res.locals.csrfToken });
});

// New product form
router.get('/products/new', auth.authenticateJWT, auth.authorizeRole(['admin']), (req, res) => {
  res.render('admin_product_form', { title: 'New Product', product: null, action: '/admin/products', csrfToken: res.locals.csrfToken });
});

// Create product
router.post('/products', auth.authenticateJWT, auth.authorizeRole(['admin']), async (req, res) => {
  let parsed;
  try {
    parsed = await parseProductForm(req);
  } catch (err) {
    return res.status(400).send('Invalid product image upload');
  }

  const { name, category, price, stock, description } = parsed.fields;
  const imageUrls = stringifyProductImages(parsed.images);
  const stmt = db.prepare('INSERT INTO products (name, category, price, stock, description, image_urls) VALUES (?, ?, ?, ?, ?, ?)');
  stmt.run(name || 'Unnamed', category || 'misc', Number(price) || 0, Number(stock) || 0, description || '', imageUrls);
  res.redirect('/admin');
});

// Edit form
router.get('/products/:id/edit', auth.authenticateJWT, auth.authorizeRole(['admin']), (req, res) => {
  const id = Number(req.params.id);
  const product = attachProductImages(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
  if (!product) return res.status(404).send('Not found');
  res.render('admin_product_form', { title: 'Edit Product', product, action: `/admin/products/${id}`, csrfToken: res.locals.csrfToken });
});

// Update product
router.post('/products/:id', auth.authenticateJWT, auth.authorizeRole(['admin']), async (req, res) => {
  const id = Number(req.params.id);
  let parsed;
  try {
    parsed = await parseProductForm(req);
  } catch (err) {
    return res.status(400).send('Invalid product image upload');
  }

  const { name, category, price, stock, description } = parsed.fields;
  const imageUrls = stringifyProductImages(parsed.images);
  const stmt = db.prepare('UPDATE products SET name = ?, category = ?, price = ?, stock = ?, description = ?, image_urls = ? WHERE id = ?');
  stmt.run(name, category, Number(price) || 0, Number(stock) || 0, description || '', imageUrls, id);
  res.redirect('/admin');
});

// Offers admin
router.get('/offers', auth.authenticateJWT, auth.authorizeRole(['admin']), (req, res) => {
  const offers = db.prepare('SELECT o.*, p.name as product_name FROM offers o LEFT JOIN products p ON p.id = o.product_id').all();
  const products = db.prepare('SELECT id, name FROM products').all();
  res.render('admin_offers', { title: 'Admin - Offers', offers, products, csrfToken: res.locals.csrfToken });
});

router.post('/offers', auth.authenticateJWT, auth.authorizeRole(['admin']),
  body('product_id').isInt({ gt: 0 }),
  body('type').isIn(['bogo','percent','hot_hour']),
  validate,
  (req, res) => {
    const { product_id, type, buy, free, percent, hour, starts_at, ends_at } = req.body;
    db.prepare('INSERT INTO offers (product_id, type, buy, free, percent, hour, starts_at, ends_at, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)')
      .run(product_id, type, buy || 0, free || 0, percent || 0, hour || null, starts_at || null, ends_at || null);
    res.redirect('/admin/offers');
});

router.post('/offers/:id/delete', auth.authenticateJWT, auth.authorizeRole(['admin']), (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM offers WHERE id = ?').run(id);
  res.redirect('/admin/offers');
});

router.get('/settings', auth.authenticateJWT, auth.authorizeRole(['admin']), (req, res) => {
  res.render('admin_settings', {
    title: 'Admin - Store Settings',
    profile: getStoreProfile(),
    error: null,
    csrfToken: res.locals.csrfToken,
  });
});

router.post('/settings', auth.authenticateJWT, auth.authorizeRole(['admin']), (req, res) => {
  const email = String(req.body.email || '').trim();
  const upiId = String(req.body.upi_id || '').trim();
  if (email && !email.includes('@')) {
    return res.status(400).render('admin_settings', {
      title: 'Admin - Store Settings',
      profile: {
        address: req.body.address || '',
        email,
        phone: req.body.phone || '',
        upi_id: upiId,
      },
      error: 'Enter a valid email address.',
      csrfToken: res.locals.csrfToken,
    });
  }

  if (upiId && !upiId.includes('@')) {
    return res.status(400).render('admin_settings', {
      title: 'Admin - Store Settings',
      profile: {
        address: req.body.address || '',
        email,
        phone: req.body.phone || '',
        upi_id: upiId,
      },
      error: 'Enter a valid UPI ID.',
      csrfToken: res.locals.csrfToken,
    });
  }

  updateStoreProfile(req.body);
  res.redirect('/admin/settings');
});

// Order desk for shopkeeper fulfilment
router.get('/orders', auth.authenticateJWT, auth.authorizeRole(['admin']), (req, res) => {
  const orders = db.prepare(`
    SELECT
      o.*,
      u.username,
      GROUP_CONCAT(oi.quantity || ' x ' || COALESCE(oi.product_name, p.name), ', ') as item_summary
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN products p ON p.id = oi.product_id
    GROUP BY o.id
    ORDER BY o.id DESC
  `).all();

  const stats = {
    newOrders: db.prepare("SELECT COUNT(1) as count FROM orders WHERE status = 'new'").get().count,
    activeOrders: db.prepare("SELECT COUNT(1) as count FROM orders WHERE status NOT IN ('delivered', 'cancelled')").get().count,
    delivered: db.prepare("SELECT COUNT(1) as count FROM orders WHERE status = 'delivered'").get().count,
  };

  res.render('admin_orders', {
    title: 'Admin - Orders',
    orders,
    stats,
    orderStatuses,
    csrfToken: res.locals.csrfToken,
  });
});

router.post('/orders/:id/status', auth.authenticateJWT, auth.authorizeRole(['admin']), (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body.status || '');
  if (!orderStatuses.includes(status)) return res.status(400).send('Invalid status');
  db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), id);
  res.redirect('/admin/orders');
});

// Recurring admin
router.get('/recurring', auth.authenticateJWT, auth.authorizeRole(['admin']), (req, res) => {
  const rows = db.prepare('SELECT ro.*, u.username FROM recurring_orders ro JOIN users u ON u.id = ro.user_id').all();
  const users = db.prepare('SELECT id, username FROM users').all();
  res.render('admin_recurring', { title: 'Admin - Recurring Orders', rows, users, csrfToken: res.locals.csrfToken });
});

router.post('/recurring', auth.authenticateJWT, auth.authorizeRole(['admin']),
  body('user_id').isInt({ gt: 0 }),
  body('cart_snapshot').isString(),
  body('interval').isIn(['weekly','monthly','bimonthly','quarterly','halfyearly']),
  body('next_run').isISO8601(),
  validate,
  (req, res) => {
    const { user_id, cart_snapshot, interval, next_run } = req.body;
    db.prepare('INSERT INTO recurring_orders (user_id, cart_snapshot, interval, next_run) VALUES (?, ?, ?, ?)').run(user_id, cart_snapshot, interval, next_run);
    res.redirect('/admin/recurring');
});

router.post('/recurring/:id/delete', auth.authenticateJWT, auth.authorizeRole(['admin']), (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM recurring_orders WHERE id = ?').run(id);
  res.redirect('/admin/recurring');
});

module.exports = router;
