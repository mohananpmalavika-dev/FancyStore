const db = require('../db');
const sendEmail = require('../utils/email');
const {
  attachProductImages,
  hasProductImagePayload,
  productImagesFromBody,
  stringifyProductImages,
} = require('../utils/productImages');

function list(req, res) {
  const rows = db.prepare('SELECT * FROM products').all().map(product => attachProductImages(product));
  res.json(rows);
}

function getById(req, res) {
  const id = Number(req.params.id);
  const p = attachProductImages(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
}

function create(req, res) {
  const payload = req.body;
  const imageUrls = stringifyProductImages(productImagesFromBody(payload));
  const stmt = db.prepare('INSERT INTO products (name, category, price, stock, description, image_urls) VALUES (?, ?, ?, ?, ?, ?)');
  const info = stmt.run(payload.name || 'Unnamed', payload.category || 'misc', payload.price || 0, payload.stock || 0, payload.description || '', imageUrls);
  const product = attachProductImages(db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid));
  // notify admin
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    sendEmail(adminEmail, 'New product added', `Product added: ${product.name} (${product.category})`)
      .catch(() => {});
  }
  res.status(201).json(product);
}

function update(req, res) {
  const id = Number(req.params.id);
  const payload = req.body;
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const imageUrls = hasProductImagePayload(payload)
    ? stringifyProductImages(productImagesFromBody(payload))
    : existing.image_urls;
  const stmt = db.prepare('UPDATE products SET name = ?, category = ?, price = ?, stock = ?, description = ?, image_urls = ? WHERE id = ?');
  stmt.run(payload.name || existing.name, payload.category || existing.category, payload.price ?? existing.price, payload.stock ?? existing.stock, payload.description ?? existing.description, imageUrls, id);
  const updated = attachProductImages(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
  res.json(updated);
}

function remove(req, res) {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  res.json(attachProductImages(existing));
}

// Increase stock - allowed to stock managers and admins via route
function addStock(req, res) {
  const id = Number(req.params.id);
  const amount = Number(req.body.amount || 0);
  if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const newStock = existing.stock + amount;
  db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(newStock, id);
  const updated = attachProductImages(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
  res.json(updated);
}

module.exports = { list, getById, create, update, remove, addStock };
