const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { attachProductImages } = require('./productImages');

const storefrontWhere = "WHERE LOWER(COALESCE(category, '')) NOT IN ('test', 'tests') AND LOWER(COALESCE(name, '')) NOT LIKE 'test%'";

const imageByCategory = {
  ornaments: '/assets/ornaments.png',
  toys: '/assets/toys.png',
  cosmetics: '/assets/cosmetics.png',
  'gift items': '/assets/gifts.png',
  'premium dresses': '/assets/dresses.png',
  default: '/assets/the-golden-crown-banner.jpg',
};

const authCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  maxAge: 8 * 60 * 60 * 1000,
};

function imageForCategory(category) {
  const key = String(category || '').toLowerCase();
  if (key.includes('ornament') || key.includes('gold')) return imageByCategory.ornaments;
  if (key.includes('toy')) return imageByCategory.toys;
  if (key.includes('cosmetic')) return imageByCategory.cosmetics;
  if (key.includes('gift')) return imageByCategory['gift items'];
  if (key.includes('dress')) return imageByCategory['premium dresses'];
  return imageByCategory.default;
}

function formatCategory(category) {
  return String(category || 'Collection')
    .split(' ')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function enrichProduct(product) {
  const withImages = attachProductImages(product, imageForCategory(product.category));
  return {
    ...withImages,
    displayCategory: formatCategory(product.category),
  };
}

function getFeaturedProducts(limit = 8) {
  return db.prepare(`SELECT * FROM products ${storefrontWhere} ORDER BY id LIMIT ?`).all(limit).map(enrichProduct);
}

function getCategories() {
  return db.prepare(`SELECT category, COUNT(*) as count FROM products ${storefrontWhere} GROUP BY category ORDER BY count DESC`).all()
    .map(row => ({
      ...row,
      image: imageForCategory(row.category),
      displayCategory: formatCategory(row.category),
    }));
}

function getActiveOffers(limit = 3) {
  return db.prepare(`
    SELECT o.*, p.name as product_name
    FROM offers o
    LEFT JOIN products p ON p.id = o.product_id
    WHERE o.active = 1
    ORDER BY o.id DESC
    LIMIT ?
  `).all(limit);
}

function signUser(user) {
  return jwt.sign(
    { id: user.id, username: user.username, email: user.email, role: user.role },
    process.env.JWT_SECRET || 'change-me',
    { expiresIn: '8h' }
  );
}

function getUserFromRequest(req) {
  const token = req.cookies && req.cookies.auth_token;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'change-me');
    return db.prepare('SELECT id, username, email, role FROM users WHERE id = ?').get(payload.id) || null;
  } catch (err) {
    return null;
  }
}

function findUserByLogin(login) {
  const value = String(login || '').trim();
  if (!value) return null;
  return db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(value, value);
}

function createCustomer({ name, email, password }) {
  const safeEmail = String(email || '').trim().toLowerCase();
  const safeName = String(name || '').trim() || safeEmail.split('@')[0] || 'customer';
  const usernameBase = safeName.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'customer';
  let username = usernameBase;
  let suffix = 1;
  while (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    suffix += 1;
    username = `${usernameBase}${suffix}`;
  }
  const hashed = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (username, password, role, email) VALUES (?, ?, ?, ?)').run(username, hashed, 'customer', safeEmail);
  return db.prepare('SELECT id, username, role, email FROM users WHERE id = ?').get(info.lastInsertRowid);
}

function getOrCreateCart(userId) {
  let cart = db.prepare('SELECT * FROM carts WHERE user_id = ?').get(userId);
  if (!cart) {
    const info = db.prepare('INSERT INTO carts (user_id) VALUES (?)').run(userId);
    cart = db.prepare('SELECT * FROM carts WHERE id = ?').get(info.lastInsertRowid);
  }
  return cart;
}

function getCartItems(userId) {
  const cart = getOrCreateCart(userId);
  return db.prepare(`
    SELECT ci.id as cart_item_id, ci.quantity, p.*
    FROM cart_items ci
    JOIN products p ON p.id = ci.product_id
    WHERE ci.cart_id = ?
    ORDER BY ci.id
  `).all(cart.id).map(enrichProduct);
}

function getCartCount(userId) {
  if (!userId) return 0;
  const cart = getOrCreateCart(userId);
  return db.prepare('SELECT COALESCE(SUM(quantity), 0) as count FROM cart_items WHERE cart_id = ?').get(cart.id).count || 0;
}

function activeOffersForProducts() {
  return db.prepare('SELECT * FROM offers WHERE active = 1').all();
}

function priceLine(item, offers = activeOffersForProducts()) {
  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.price || 0);
  const subtotal = unitPrice * quantity;
  let payableQuantity = quantity;
  let discount = 0;
  const labels = [];

  const bogo = offers.find(offer => offer.product_id === item.id && offer.type === 'bogo');
  if (bogo && Number(bogo.buy) > 0 && Number(bogo.free) > 0) {
    const setSize = Number(bogo.buy) + Number(bogo.free);
    const freeItems = Math.floor(quantity / setSize) * Number(bogo.free);
    payableQuantity = Math.max(0, quantity - freeItems);
    discount += freeItems * unitPrice;
    if (freeItems) labels.push(`Buy ${bogo.buy}, get ${bogo.free}`);
  }

  let lineTotal = payableQuantity * unitPrice;
  const percent = offers.find(offer => offer.product_id === item.id && offer.type === 'percent');
  if (percent && Number(percent.percent) > 0) {
    const percentDiscount = lineTotal * (Number(percent.percent) / 100);
    discount += percentDiscount;
    lineTotal -= percentDiscount;
    labels.push(`${Number(percent.percent).toFixed(0)}% off`);
  }

  return {
    subtotal,
    discount,
    lineTotal,
    offerLabel: labels.join(' + '),
  };
}

function cartTotals(items) {
  const offers = activeOffersForProducts();
  const lines = items.map(item => {
    const pricing = priceLine(item, offers);
    return { ...item, ...pricing };
  });
  const subtotal = lines.reduce((sum, item) => sum + item.subtotal, 0);
  const discount = lines.reduce((sum, item) => sum + item.discount, 0);
  const deliveryFee = lines.length ? (subtotal - discount >= 99 ? 0 : 5.99) : 0;
  const total = subtotal - discount + deliveryFee;

  return { lines, subtotal, discount, deliveryFee, total };
}

function createOrderFromCart(userId, delivery) {
  const items = getCartItems(userId);
  if (!items.length) throw new Error('cart_empty');

  const totals = cartTotals(items);
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const item of totals.lines) {
      const fresh = db.prepare('SELECT stock FROM products WHERE id = ?').get(item.id);
      if (!fresh || Number(fresh.stock) < Number(item.quantity)) {
        throw new Error(`stock_unavailable:${item.name}`);
      }
    }

    const orderInfo = db.prepare(`
      INSERT INTO orders (
        user_id, total, subtotal, discount_total, delivery_fee, status,
        customer_name, customer_email, customer_phone, delivery_address,
        delivery_city, delivery_pincode, delivery_note, delivery_date,
        payment_method, payment_utr, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      totals.total,
      totals.subtotal,
      totals.discount,
      totals.deliveryFee,
      'new',
      delivery.customer_name,
      delivery.customer_email,
      delivery.customer_phone,
      delivery.delivery_address,
      delivery.delivery_city,
      delivery.delivery_pincode,
      delivery.delivery_note || null,
      delivery.delivery_date || null,
      delivery.payment_method || 'pay_on_delivery',
      delivery.payment_utr || null,
      now
    );

    for (const item of totals.lines) {
      db.prepare(`
        INSERT INTO order_items (order_id, product_id, quantity, price, product_name, line_total)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(orderInfo.lastInsertRowid, item.id, item.quantity, item.price, item.name, item.lineTotal);
      db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(item.quantity, item.id);
    }

    const cart = getOrCreateCart(userId);
    db.prepare('DELETE FROM cart_items WHERE cart_id = ?').run(cart.id);

    return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderInfo.lastInsertRowid);
  });

  return tx();
}

function getOrderForUser(orderId, userId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(orderId, userId);
  if (!order) return null;
  const items = db.prepare(`
    SELECT oi.*, p.category, p.image_urls
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ?
  `).all(order.id).map(item => ({
    ...attachProductImages(item, imageForCategory(item.category)),
    displayCategory: formatCategory(item.category),
  }));
  return { ...order, items };
}

module.exports = {
  authCookieOptions,
  cartTotals,
  createCustomer,
  createOrderFromCart,
  enrichProduct,
  findUserByLogin,
  formatCategory,
  getActiveOffers,
  getCartCount,
  getCartItems,
  getCategories,
  getFeaturedProducts,
  getOrderForUser,
  getOrCreateCart,
  getUserFromRequest,
  imageForCategory,
  signUser,
};
