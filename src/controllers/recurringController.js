const db = require('../db');

function list(req, res) {
  const userId = req.user.id;
  const rows = db.prepare('SELECT * FROM recurring_orders WHERE user_id = ?').all(userId);
  res.json(rows);
}

function create(req, res) {
  const userId = req.user.id;
  const { cart_snapshot, interval, next_run } = req.body;
  if (!cart_snapshot || !interval || !next_run) return res.status(400).json({ error: 'missing fields' });
  const info = db.prepare('INSERT INTO recurring_orders (user_id, cart_snapshot, interval, next_run) VALUES (?, ?, ?, ?)').run(userId, JSON.stringify(cart_snapshot), interval, next_run);
  const row = db.prepare('SELECT * FROM recurring_orders WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(row);
}

function remove(req, res) {
  const userId = req.user.id;
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM recurring_orders WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) return res.status(404).json({ error: 'not found' });
  db.prepare('DELETE FROM recurring_orders WHERE id = ?').run(id);
  res.json(row);
}

module.exports = { list, create, remove };
