const db = require('../db');
const { cartTotals, createOrderFromCart } = require('../utils/storefront');

function getOrCreateCart(userId) {
  let cart = db.prepare('SELECT * FROM carts WHERE user_id = ?').get(userId);
  if (!cart) {
    const info = db.prepare('INSERT INTO carts (user_id) VALUES (?)').run(userId);
    cart = db.prepare('SELECT * FROM carts WHERE id = ?').get(info.lastInsertRowid);
  }
  return cart;
}

function view(req, res) {
  const userId = req.user.id;
  const cart = getOrCreateCart(userId);
  const items = db.prepare('SELECT ci.id, ci.quantity, p.* FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.cart_id = ?').all(cart.id);
  res.json({ cart, items });
}

function addItem(req, res) {
  const userId = req.user.id;
  const { product_id, quantity } = req.body;
  if (!product_id || !Number.isInteger(Number(quantity)) || Number(quantity) <= 0) return res.status(400).json({ error: 'invalid payload' });
  const cart = getOrCreateCart(userId);
  const existing = db.prepare('SELECT * FROM cart_items WHERE cart_id = ? AND product_id = ?').get(cart.id, product_id);
  if (existing) {
    db.prepare('UPDATE cart_items SET quantity = quantity + ? WHERE id = ?').run(quantity, existing.id);
  } else {
    db.prepare('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)').run(cart.id, product_id, quantity);
  }
  return view(req, res);
}

function updateItem(req, res) {
  const userId = req.user.id;
  const id = Number(req.params.id);
  const { quantity } = req.body;
  if (!Number.isInteger(Number(quantity)) || Number(quantity) < 0) return res.status(400).json({ error: 'invalid quantity' });
  const item = db.prepare('SELECT ci.* FROM cart_items ci JOIN carts c ON c.id = ci.cart_id WHERE ci.id = ? AND c.user_id = ?').get(id, userId);
  if (!item) return res.status(404).json({ error: 'not found' });
  if (Number(quantity) === 0) {
    db.prepare('DELETE FROM cart_items WHERE id = ?').run(id);
  } else {
    db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(quantity, id);
  }
  return view(req, res);
}

function clear(req, res) {
  const userId = req.user.id;
  const cart = getOrCreateCart(userId);
  db.prepare('DELETE FROM cart_items WHERE cart_id = ?').run(cart.id);
  res.json({ ok: true });
}

function checkout(req, res) {
  const userId = req.user.id;
  const cart = getOrCreateCart(userId);
  const items = db.prepare(`
    SELECT ci.quantity, p.*
    FROM cart_items ci
    JOIN products p ON p.id = ci.product_id
    WHERE ci.cart_id = ?
  `).all(cart.id);

  if (!req.body || !req.body.delivery_address) {
    const totals = cartTotals(items);
    return res.json({
      total: totals.total,
      subtotal: totals.subtotal,
      discount_total: totals.discount,
      delivery_fee: totals.deliveryFee,
      details: totals.lines.map(item => ({
        product_id: item.id,
        quantity: item.quantity,
        line_total: item.lineTotal,
        offer: item.offerLabel,
      })),
    });
  }

  const paymentMethod = ['pay_on_delivery', 'shop_contact', 'upi'].includes(req.body.payment_method)
    ? req.body.payment_method
    : 'pay_on_delivery';
  const paymentUtr = String(req.body.payment_utr || '').trim().slice(0, 80);
  if (paymentMethod === 'upi' && !paymentUtr) {
    return res.status(400).json({ error: 'payment_utr is required for UPI payments' });
  }

  try {
    const order = createOrderFromCart(userId, {
      customer_name: req.body.customer_name || req.user.username,
      customer_email: req.body.customer_email || req.user.email,
      customer_phone: req.body.customer_phone || '',
      delivery_address: req.body.delivery_address,
      delivery_city: req.body.delivery_city || '',
      delivery_pincode: req.body.delivery_pincode || '',
      delivery_note: req.body.delivery_note || '',
      delivery_date: req.body.delivery_date || null,
      payment_method: paymentMethod,
      payment_utr: paymentUtr,
    });
    res.status(201).json(order);
  } catch (err) {
    if (err.message === 'cart_empty') return res.status(400).json({ error: 'cart is empty' });
    if (err.message.startsWith('stock_unavailable:')) {
      return res.status(409).json({ error: 'stock unavailable', product: err.message.split(':')[1] });
    }
    res.status(500).json({ error: 'checkout failed' });
  }
}

module.exports = { view, addItem, updateItem, clear, checkout };
