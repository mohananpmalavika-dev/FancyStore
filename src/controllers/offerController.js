const db = require('../db');

function list(req, res) {
  const rows = db.prepare('SELECT * FROM offers').all();
  res.json(rows);
}

function create(req, res) {
  const p = req.body;
  const stmt = db.prepare('INSERT INTO offers (product_id, type, buy, free, percent, hour, starts_at, ends_at, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const info = stmt.run(p.product_id, p.type, p.buy || 0, p.free || 0, p.percent || 0, p.hour, p.starts_at, p.ends_at, p.active ? 1 : 0);
  const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(offer);
}

function remove(req, res) {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM offers WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM offers WHERE id = ?').run(id);
  res.json(existing);
}

module.exports = { list, create, remove };
