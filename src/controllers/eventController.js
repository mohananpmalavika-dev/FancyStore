const db = require('../db');

function list(req, res) {
  const userId = req.user.id;
  const rows = db.prepare('SELECT * FROM user_events WHERE user_id = ?').all(userId);
  res.json(rows);
}

function create(req, res) {
  const userId = req.user.id;
  const { type, relation, name, event_date } = req.body;
  if (!type || !event_date) return res.status(400).json({ error: 'type and event_date are required' });
  const allowed = ['birthday', 'anniversary', 'spouse_birthday', 'child_birthday'];
  if (!allowed.includes(type)) return res.status(400).json({ error: 'invalid type' });
  const info = db.prepare('INSERT INTO user_events (user_id, type, relation, name, event_date) VALUES (?, ?, ?, ?, ?)').run(userId, type, relation || null, name || null, event_date);
  const row = db.prepare('SELECT * FROM user_events WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(row);
}

function remove(req, res) {
  const userId = req.user.id;
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM user_events WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) return res.status(404).json({ error: 'not found' });
  db.prepare('DELETE FROM user_events WHERE id = ?').run(id);
  res.json(row);
}

module.exports = { list, create, remove };