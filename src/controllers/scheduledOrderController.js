const db = require('../db');

function list(req, res) {
  const userId = req.user.id;
  const rows = db.prepare('SELECT * FROM scheduled_orders WHERE user_id = ?').all(userId);
  res.json(rows);
}

function create(req, res) {
  const userId = req.user.id;
  const { cart_snapshot, delivery_date, description, delivery_type, related_event_id } = req.body;
  
  if (!cart_snapshot || !delivery_date) {
    return res.status(400).json({ error: 'cart_snapshot and delivery_date are required' });
  }
  
  const allowedTypes = ['standard', 'same_day', 'special_event'];
  const type = delivery_type && allowedTypes.includes(delivery_type) ? delivery_type : 'standard';
  
  let finalDeliveryDate = delivery_date;
  let relatedEventId = related_event_id || null;
  
  // For special_event type, verify the event exists and calculate delivery date
  if (type === 'special_event' && related_event_id) {
    const event = db.prepare('SELECT * FROM user_events WHERE id = ? AND user_id = ?').get(related_event_id, userId);
    if (!event) {
      return res.status(400).json({ error: 'related_event_id not found or does not belong to user' });
    }
    // Use event date for delivery
    finalDeliveryDate = event.event_date;
    relatedEventId = related_event_id;
  }
  
  // For same_day type, set delivery to today
  if (type === 'same_day') {
    const today = new Date().toISOString().split('T')[0];
    finalDeliveryDate = today;
  }
  
  const info = db.prepare(
    'INSERT INTO scheduled_orders (user_id, cart_snapshot, delivery_date, description, delivery_type, related_event_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userId, JSON.stringify(cart_snapshot), finalDeliveryDate, description || null, type, relatedEventId);
  
  const row = db.prepare('SELECT * FROM scheduled_orders WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(row);
}

function update(req, res) {
  const userId = req.user.id;
  const id = Number(req.params.id);
  const { description, delivery_type, related_event_id } = req.body;
  
  const row = db.prepare('SELECT * FROM scheduled_orders WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) return res.status(404).json({ error: 'not found' });
  
  const allowedTypes = ['standard', 'same_day', 'special_event'];
  const type = delivery_type && allowedTypes.includes(delivery_type) ? delivery_type : row.delivery_type;
  
  let newDeliveryDate = row.delivery_date;
  let relatedEventId = related_event_id !== undefined ? related_event_id : row.related_event_id;
  
  if (type === 'special_event' && related_event_id) {
    const event = db.prepare('SELECT * FROM user_events WHERE id = ? AND user_id = ?').get(related_event_id, userId);
    if (!event) {
      return res.status(400).json({ error: 'related_event_id not found or does not belong to user' });
    }
    newDeliveryDate = event.event_date;
    relatedEventId = related_event_id;
  }
  
  db.prepare(
    'UPDATE scheduled_orders SET description = ?, delivery_type = ?, related_event_id = ?, delivery_date = ? WHERE id = ?'
  ).run(description !== undefined ? description : row.description, type, relatedEventId, newDeliveryDate, id);
  
  const updated = db.prepare('SELECT * FROM scheduled_orders WHERE id = ?').get(id);
  res.json(updated);
}

function remove(req, res) {
  const userId = req.user.id;
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM scheduled_orders WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) return res.status(404).json({ error: 'not found' });
  db.prepare('DELETE FROM scheduled_orders WHERE id = ?').run(id);
  res.json(row);
}

module.exports = { list, create, update, remove };