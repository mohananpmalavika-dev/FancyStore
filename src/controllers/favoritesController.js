const db = require('../db');

function list(req, res) {
  const userId = req.user.id;
  const rows = db.prepare('SELECT p.* FROM favorites f JOIN products p ON p.id = f.product_id WHERE f.user_id = ?').all(userId);
  res.json(rows);
}

function add(req, res) {
  const userId = req.user.id;
  const { product_id } = req.body;
  if (!product_id) return res.status(400).json({ error: 'product_id required' });
  try {
    db.prepare('INSERT INTO favorites (user_id, product_id) VALUES (?,?)').run(userId, product_id);
  } catch (e) {
    // ignore duplicate
  }
  res.json({ ok: true });
}

function remove(req, res) {
  const userId = req.user.id;
  const pid = Number(req.params.product_id);
  db.prepare('DELETE FROM favorites WHERE user_id = ? AND product_id = ?').run(userId, pid);
  res.json({ ok: true });
}

module.exports = { list, add, remove };
