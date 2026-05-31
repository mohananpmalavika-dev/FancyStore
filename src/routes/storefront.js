const express = require('express');
const bcrypt = require('bcryptjs');
const csurf = require('csurf');
const db = require('../db');
const sendEmail = require('../utils/email');
const { formatRupees } = require('../utils/currency');
const {
  authCookieOptions,
  cartTotals,
  createCustomer,
  createOrderFromCart,
  enrichProduct,
  findUserByLogin,
  getActiveOffers,
  getCartCount,
  getCartItems,
  getCategories,
  getFeaturedProducts,
  getOrderForUser,
  getOrCreateCart,
  getUserFromRequest,
  signUser,
} = require('../utils/storefront');

const router = express.Router();
const csrfProtection = csurf({ cookie: true });

const catalogFilter = "LOWER(COALESCE(category, '')) NOT IN ('test', 'tests') AND LOWER(COALESCE(name, '')) NOT LIKE 'test%'";
const orderStatuses = ['new', 'accepted', 'packed', 'out_for_delivery', 'delivered', 'cancelled'];

router.use(csrfProtection);
router.use((req, res, next) => {
  const currentUser = getUserFromRequest(req);
  res.locals.currentUser = currentUser;
  res.locals.cartCount = currentUser ? getCartCount(currentUser.id) : 0;
  res.locals.csrfToken = req.csrfToken();
  next();
});

function safeNext(value, fallback = '/shop') {
  const target = String(value || '').trim();
  if (target.startsWith('/') && !target.startsWith('//')) return target;
  return fallback;
}

function localTarget(value, fallback = '/shop') {
  const target = String(value || '').trim();
  if (target.startsWith('/') && !target.startsWith('//')) return target;
  try {
    const parsed = new URL(target);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (err) {
    return fallback;
  }
}

function withNotice(target, key, message) {
  const url = new URL(localTarget(target), 'https://fancystore.local');
  url.searchParams.set(key, message);
  return `${url.pathname}${url.search}${url.hash}`;
}

function upiPaymentLink(profile, amount) {
  const upiId = String((profile && profile.upi_id) || '').trim();
  const payableAmount = Number(amount || 0);
  if (!upiId || payableAmount <= 0) return '';

  const link = new URL('upi://pay');
  link.searchParams.set('pa', upiId);
  link.searchParams.set('pn', 'The Golden Crown');
  link.searchParams.set('am', payableAmount.toFixed(2));
  link.searchParams.set('cu', 'INR');
  link.searchParams.set('tn', 'The Golden Crown order payment');
  return link.toString();
}

function requireCustomer(req, res, next) {
  if (!res.locals.currentUser) {
    return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl || '/shop')}`);
  }
  req.user = res.locals.currentUser;
  next();
}

function offerLabel(offer) {
  if (offer.type === 'percent') return `${Number(offer.percent || 0).toFixed(0)}% off`;
  if (offer.type === 'bogo') return `Buy ${offer.buy}, get ${offer.free}`;
  if (offer.type === 'hot_hour') return `Hot hour ${String(offer.hour || 0).padStart(2, '0')}:00`;
  return 'Special offer';
}

function offerMap() {
  const rows = db.prepare('SELECT * FROM offers WHERE active = 1').all();
  return rows.reduce((map, offer) => {
    if (!map[offer.product_id]) map[offer.product_id] = [];
    map[offer.product_id].push(offerLabel(offer));
    return map;
  }, {});
}

function attachOfferLabels(products) {
  const labels = offerMap();
  return products.map(product => ({
    ...product,
    offerLabels: labels[product.id] || [],
  }));
}

function searchProducts({ q, category }) {
  const clauses = [catalogFilter];
  const params = [];
  const query = String(q || '').trim();
  const selectedCategory = String(category || '').trim();

  if (query) {
    clauses.push('(LOWER(name) LIKE ? OR LOWER(description) LIKE ? OR LOWER(category) LIKE ?)');
    const like = `%${query.toLowerCase()}%`;
    params.push(like, like, like);
  }

  if (selectedCategory) {
    clauses.push('LOWER(category) = LOWER(?)');
    params.push(selectedCategory);
  }

  return db.prepare(`
    SELECT *
    FROM products
    WHERE ${clauses.join(' AND ')}
    ORDER BY category, name
    LIMIT 60
  `).all(...params).map(enrichProduct);
}

function getCartSnapshot(userId) {
  return getCartItems(userId).map(item => ({
    product_id: item.id,
    name: item.name,
    quantity: Number(item.quantity || 0),
    price: Number(item.price || 0),
  }));
}

function describeSnapshot(snapshot) {
  try {
    const items = JSON.parse(snapshot || '[]');
    if (!Array.isArray(items) || !items.length) return 'No items';
    return items.map(item => `${item.quantity || 1} x ${item.name || `Product #${item.product_id}`}`).join(', ');
  } catch (err) {
    return 'Saved cart';
  }
}

function customerAccountData(userId) {
  const favoriteRows = db.prepare(`
    SELECT p.*
    FROM favorites f
    JOIN products p ON p.id = f.product_id
    WHERE f.user_id = ?
    ORDER BY f.created_at DESC
  `).all(userId).map(enrichProduct);

  const scheduled = db.prepare(`
    SELECT *
    FROM scheduled_orders
    WHERE user_id = ?
    ORDER BY delivery_date DESC
  `).all(userId).map(row => ({
    ...row,
    summary: describeSnapshot(row.cart_snapshot),
  }));

  const recurring = db.prepare(`
    SELECT *
    FROM recurring_orders
    WHERE user_id = ?
    ORDER BY next_run DESC
  `).all(userId).map(row => ({
    ...row,
    summary: describeSnapshot(row.cart_snapshot),
  }));

  return {
    orders: db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC').all(userId),
    favorites: attachOfferLabels(favoriteRows),
    events: db.prepare('SELECT * FROM user_events WHERE user_id = ? ORDER BY event_date').all(userId),
    scheduled,
    recurring,
  };
}

function trimField(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function recentTestimonials(limit = 24) {
  return db.prepare(`
    SELECT name, rating, message, created_at
    FROM feedback
    WHERE display_as_testimonial = 1
    ORDER BY id DESC
    LIMIT ?
  `).all(limit);
}

router.get('/', (req, res) => {
  const products = attachOfferLabels(getFeaturedProducts(8));
  const categories = getCategories();
  const offers = getActiveOffers(4);
  res.render('home', {
    title: 'The Golden Crown | Fine jewellery and cosmetics',
    products,
    categories,
    offers,
    featured: products[0] || null,
    notice: req.query.notice || null,
  });
});

router.get('/shop', (req, res) => {
  const products = attachOfferLabels(searchProducts(req.query));
  res.render('storefront_shop', {
    title: 'Shop The Golden Crown',
    products,
    categories: getCategories(),
    selectedCategory: req.query.category || '',
    q: req.query.q || '',
    notice: req.query.notice || null,
  });
});

router.get('/contact', (req, res) => {
  res.render('storefront_contact', {
    title: 'Contact The Golden Crown',
    notice: req.query.notice || null,
    error: req.query.error || null,
    values: {},
  });
});

router.post('/contact', (req, res) => {
  const values = {
    name: trimField(req.body.name, 120),
    email: trimField(req.body.email, 160).toLowerCase(),
    phone: trimField(req.body.phone, 40),
    message: trimField(req.body.message, 1200),
  };

  if (!values.name || !values.message || (values.email && !values.email.includes('@'))) {
    return res.status(400).render('storefront_contact', {
      title: 'Contact The Golden Crown',
      notice: null,
      error: 'Please enter your name, a valid email if used, and your message.',
      values,
    });
  }

  db.prepare(`
    INSERT INTO contact_messages (name, email, phone, message)
    VALUES (?, ?, ?, ?)
  `).run(values.name, values.email || null, values.phone || null, values.message);

  const notifyEmail = res.locals.storeProfile.email || process.env.ADMIN_EMAIL;
  if (notifyEmail) {
    sendEmail(
      notifyEmail,
      `New Golden Crown contact message from ${values.name}`,
      `Name: ${values.name}\nEmail: ${values.email || '-'}\nPhone: ${values.phone || '-'}\n\n${values.message}`
    ).catch(() => {});
  }

  res.redirect(withNotice('/contact', 'notice', 'Thanks. Your message has been sent to the shop.'));
});

router.get('/feedback', (req, res) => {
  res.render('storefront_feedback', {
    title: 'Feedback | The Golden Crown',
    notice: req.query.notice || null,
    error: req.query.error || null,
    values: { rating: 5, display_as_testimonial: '1' },
  });
});

router.post('/feedback', (req, res) => {
  const values = {
    name: trimField(req.body.name, 120),
    email: trimField(req.body.email, 160).toLowerCase(),
    rating: Math.min(5, Math.max(1, Number(req.body.rating || 5))),
    message: trimField(req.body.message, 1200),
    display_as_testimonial: req.body.display_as_testimonial ? '1' : '',
  };

  if (!values.name || !values.message || (values.email && !values.email.includes('@'))) {
    return res.status(400).render('storefront_feedback', {
      title: 'Feedback | The Golden Crown',
      notice: null,
      error: 'Please enter your name, a valid email if used, and your feedback.',
      values,
    });
  }

  db.prepare(`
    INSERT INTO feedback (name, email, rating, message, display_as_testimonial)
    VALUES (?, ?, ?, ?, ?)
  `).run(values.name, values.email || null, values.rating, values.message, values.display_as_testimonial ? 1 : 0);

  res.redirect(withNotice('/feedback', 'notice', 'Thank you for sharing your feedback.'));
});

router.get('/testimonials', (req, res) => {
  res.render('storefront_testimonials', {
    title: 'Testimonials | The Golden Crown',
    testimonials: recentTestimonials(),
    notice: req.query.notice || null,
  });
});

router.get('/login', (req, res) => {
  if (res.locals.currentUser) return res.redirect(safeNext(req.query.next));
  res.render('storefront_auth', {
    title: 'Customer Login',
    mode: 'login',
    next: safeNext(req.query.next),
    error: null,
  });
});

router.post('/login', (req, res) => {
  const login = String(req.body.login || '').trim();
  const password = String(req.body.password || '');
  const user = findUserByLogin(login);
  const ok = user && bcrypt.compareSync(password, user.password);

  if (!ok) {
    return res.status(401).render('storefront_auth', {
      title: 'Customer Login',
      mode: 'login',
      next: safeNext(req.body.next),
      error: 'Check your Gmail/email and password, then try again.',
    });
  }

  res.cookie('auth_token', signUser(user), authCookieOptions);
  res.redirect(safeNext(req.body.next));
});

router.get('/register', (req, res) => {
  if (res.locals.currentUser) return res.redirect(safeNext(req.query.next));
  res.render('storefront_auth', {
    title: 'Create Customer Account',
    mode: 'register',
    next: safeNext(req.query.next),
    error: null,
  });
});

router.post('/register', (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!email.includes('@') || password.length < 6) {
    return res.status(400).render('storefront_auth', {
      title: 'Create Customer Account',
      mode: 'register',
      next: safeNext(req.body.next),
      error: 'Use a valid Gmail/email address and a password with at least 6 characters.',
    });
  }

  try {
    const user = createCustomer({ name, email, password });
    res.cookie('auth_token', signUser(user), authCookieOptions);
    res.redirect(safeNext(req.body.next));
  } catch (err) {
    res.status(400).render('storefront_auth', {
      title: 'Create Customer Account',
      mode: 'register',
      next: safeNext(req.body.next),
      error: 'That email is already registered. Please log in instead.',
    });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.redirect('/');
});

router.post('/shop/cart-items', requireCustomer, (req, res) => {
  const productId = Number(req.body.product_id);
  const quantity = Math.max(1, Number(req.body.quantity || 1));
  const redirectTo = localTarget(req.body.redirect_to || req.get('referer'), '/shop');
  const product = db.prepare(`SELECT * FROM products WHERE id = ? AND ${catalogFilter}`).get(productId);

  if (!product || Number(product.stock || 0) <= 0) {
    return res.redirect(withNotice(redirectTo, 'notice', 'That item is currently unavailable.'));
  }

  const cart = getOrCreateCart(req.user.id);
  const existing = db.prepare('SELECT * FROM cart_items WHERE cart_id = ? AND product_id = ?').get(cart.id, productId);
  const currentQuantity = existing ? Number(existing.quantity || 0) : 0;
  const nextQuantity = Math.min(currentQuantity + quantity, Number(product.stock || 0));

  if (existing) {
    db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(nextQuantity, existing.id);
  } else {
    db.prepare('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)').run(cart.id, productId, nextQuantity);
  }

  res.redirect(withNotice(redirectTo, 'notice', `${product.name} added to your bag.`));
});

router.get('/bag', requireCustomer, (req, res) => {
  const items = getCartItems(req.user.id);
  const totals = cartTotals(items);
  res.render('storefront_bag', {
    title: 'Your Bag',
    items: totals.lines,
    totals,
    upiPaymentLink: upiPaymentLink(res.locals.storeProfile, totals.total),
    notice: req.query.notice || null,
    error: req.query.error || null,
  });
});

router.post('/bag/items/:id', requireCustomer, (req, res) => {
  const itemId = Number(req.params.id);
  const quantity = Math.max(0, Number(req.body.quantity || 0));
  const item = db.prepare(`
    SELECT ci.*
    FROM cart_items ci
    JOIN carts c ON c.id = ci.cart_id
    WHERE ci.id = ? AND c.user_id = ?
  `).get(itemId, req.user.id);

  if (item) {
    if (quantity === 0) db.prepare('DELETE FROM cart_items WHERE id = ?').run(itemId);
    else db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(quantity, itemId);
  }

  res.redirect('/bag');
});

router.post('/bag/clear', requireCustomer, (req, res) => {
  const cart = getOrCreateCart(req.user.id);
  db.prepare('DELETE FROM cart_items WHERE cart_id = ?').run(cart.id);
  res.redirect(withNotice('/bag', 'notice', 'Your bag is clear.'));
});

router.post('/bag/checkout', requireCustomer, async (req, res) => {
  const deliveryAddress = String(req.body.delivery_address || '').trim();
  if (!deliveryAddress) {
    return res.redirect(withNotice('/bag', 'error', 'Delivery address is required.'));
  }

  const paymentMethod = ['pay_on_delivery', 'shop_contact', 'upi'].includes(req.body.payment_method)
    ? req.body.payment_method
    : 'pay_on_delivery';
  const paymentUtr = trimField(req.body.payment_utr, 80);
  if (paymentMethod === 'upi' && !paymentUtr) {
    return res.redirect(withNotice('/bag', 'error', 'Enter the UPI UTR before placing the order.'));
  }

  try {
    const order = createOrderFromCart(req.user.id, {
      customer_name: req.body.customer_name || req.user.username,
      customer_email: req.body.customer_email || req.user.email,
      customer_phone: req.body.customer_phone || '',
      delivery_address: deliveryAddress,
      delivery_city: req.body.delivery_city || '',
      delivery_pincode: req.body.delivery_pincode || '',
      delivery_note: req.body.delivery_note || '',
      delivery_date: req.body.delivery_date || null,
      payment_method: paymentMethod,
      payment_utr: paymentUtr,
    });

    if (process.env.ADMIN_EMAIL) {
      sendEmail(
        process.env.ADMIN_EMAIL,
        `New Golden Crown order #${order.id}`,
        `New order #${order.id} for ${order.customer_name}. Total: ${formatRupees(order.total)}. Deliver to: ${order.delivery_address}`
      ).catch(() => {});
    }

    res.redirect(`/orders/${order.id}`);
  } catch (err) {
    if (err.message === 'cart_empty') return res.redirect(withNotice('/bag', 'error', 'Your bag is empty.'));
    if (err.message.startsWith('stock_unavailable:')) {
      return res.redirect(withNotice('/bag', 'error', `${err.message.split(':')[1]} is not available in that quantity.`));
    }
    res.redirect(withNotice('/bag', 'error', 'Checkout failed. Please try again.'));
  }
});

router.post('/bag/scheduled', requireCustomer, (req, res) => {
  const snapshot = getCartSnapshot(req.user.id);
  if (!snapshot.length) return res.redirect(withNotice('/bag', 'error', 'Add items before scheduling a delivery.'));

  db.prepare(`
    INSERT INTO scheduled_orders (user_id, cart_snapshot, delivery_date, description, delivery_type)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    req.user.id,
    JSON.stringify(snapshot),
    req.body.delivery_date,
    req.body.description || 'Customer scheduled delivery',
    req.body.delivery_type || 'standard'
  );

  res.redirect(withNotice('/account', 'notice', 'Scheduled delivery saved.'));
});

router.post('/bag/recurring', requireCustomer, (req, res) => {
  const snapshot = getCartSnapshot(req.user.id);
  if (!snapshot.length) return res.redirect(withNotice('/bag', 'error', 'Add items before creating a recurring order.'));

  db.prepare('INSERT INTO recurring_orders (user_id, cart_snapshot, interval, next_run) VALUES (?, ?, ?, ?)')
    .run(req.user.id, JSON.stringify(snapshot), req.body.interval || 'monthly', req.body.next_run);

  res.redirect(withNotice('/account', 'notice', 'Recurring order saved.'));
});

router.get('/orders/:id', requireCustomer, (req, res) => {
  const order = getOrderForUser(Number(req.params.id), req.user.id);
  if (!order) return res.status(404).send('Order not found');
  res.render('storefront_order', { title: `Order #${order.id}`, order, orderStatuses });
});

router.get('/account', requireCustomer, (req, res) => {
  res.render('storefront_account', {
    title: 'My Golden Crown',
    ...customerAccountData(req.user.id),
    notice: req.query.notice || null,
  });
});

router.post('/favorites/:productId', requireCustomer, (req, res) => {
  const productId = Number(req.params.productId);
  try {
    db.prepare('INSERT INTO favorites (user_id, product_id) VALUES (?, ?)').run(req.user.id, productId);
  } catch (err) {
    // Duplicate favorites are harmless.
  }
  res.redirect(withNotice(req.body.redirect_to || req.get('referer') || '/shop', 'notice', 'Saved to favorites.'));
});

router.post('/favorites/:productId/remove', requireCustomer, (req, res) => {
  db.prepare('DELETE FROM favorites WHERE user_id = ? AND product_id = ?').run(req.user.id, Number(req.params.productId));
  res.redirect(withNotice(req.body.redirect_to || '/account', 'notice', 'Removed from favorites.'));
});

router.post('/account/events', requireCustomer, (req, res) => {
  const type = String(req.body.type || 'birthday');
  const allowed = ['birthday', 'anniversary', 'spouse_birthday', 'child_birthday'];
  if (!allowed.includes(type) || !req.body.event_date) {
    return res.redirect(withNotice('/account', 'notice', 'Please choose an event type and date.'));
  }

  db.prepare(`
    INSERT INTO user_events (user_id, type, relation, name, event_date)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.user.id, type, req.body.relation || '', req.body.name || '', req.body.event_date);

  res.redirect(withNotice('/account', 'notice', 'Reminder saved.'));
});

router.post('/account/events/:id/delete', requireCustomer, (req, res) => {
  db.prepare('DELETE FROM user_events WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  res.redirect(withNotice('/account', 'notice', 'Reminder deleted.'));
});

router.post('/account/scheduled/:id/delete', requireCustomer, (req, res) => {
  db.prepare('DELETE FROM scheduled_orders WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  res.redirect(withNotice('/account', 'notice', 'Scheduled delivery deleted.'));
});

router.post('/account/recurring/:id/delete', requireCustomer, (req, res) => {
  db.prepare('DELETE FROM recurring_orders WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  res.redirect(withNotice('/account', 'notice', 'Recurring order deleted.'));
});

module.exports = router;
