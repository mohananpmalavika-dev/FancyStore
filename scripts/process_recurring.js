const path = require('path');
const Database = require('better-sqlite3');
const sendEmail = require('../src/utils/email');

const dbPath = path.resolve(__dirname, '..', 'fancystore.db');
const db = new Database(dbPath);

function addInterval(date, interval) {
  const d = new Date(date);
  switch (interval) {
    case 'weekly': d.setDate(d.getDate() + 7); break;
    case 'monthly': d.setMonth(d.getMonth() + 1); break;
    case 'bimonthly': d.setMonth(d.getMonth() + 2); break;
    case 'quarterly': d.setMonth(d.getMonth() + 3); break;
    case 'halfyearly': d.setMonth(d.getMonth() + 6); break;
    default: d.setMonth(d.getMonth() + 1);
  }
  return d.toISOString();
}

function formatGreeting(type, relation, name) {
  switch (type) {
    case 'birthday':
      return `Happy Birthday${name ? `, ${name}` : ''}! Wishing you a wonderful year ahead.`;
    case 'anniversary':
      return `Happy Anniversary${name ? `, ${name}` : ''}! Wishing you many more years of happiness.`;
    case 'spouse_birthday':
      return `Happy Birthday to your spouse${name ? `, ${name}` : ''}! Enjoy the celebration.`;
    case 'child_birthday':
      return `Happy Birthday to your child${name ? `, ${name}` : ''}! Have a beautiful day.`;
    default:
      return `Happy day${name ? `, ${name}` : ''}!`;
  }
}

function processUserEvents() {
  const currentYear = new Date().getFullYear();
  const todayKey = new Date().toISOString().slice(5, 10);
  const events = db.prepare(
    "SELECT ue.*, u.email as user_email, u.username FROM user_events ue JOIN users u ON u.id = ue.user_id WHERE strftime('%m-%d', ue.event_date) = ?"
  ).all(todayKey);

  events.forEach(e => {
    if (e.last_notified_year === currentYear) return;
    const to = e.user_email || process.env.ADMIN_EMAIL;
    if (!to) return;
    const subject = `Greeting for ${e.type.replace('_', ' ')}`;
    const text = formatGreeting(e.type, e.relation, e.name || e.username);
    sendEmail(to, subject, text).catch(err => console.error('greeting email failed', err.message));
    db.prepare('UPDATE user_events SET last_notified_year = ? WHERE id = ?').run(currentYear, e.id);
    console.log(`Sent greeting for event ${e.id} to ${to}`);
  });
}

function processScheduledOrders() {
  const today = new Date().toISOString().slice(0, 10);
  const rows = db.prepare(
    'SELECT so.*, u.email as user_email, u.username, ue.type as event_type, ue.relation, ue.name as event_name FROM scheduled_orders so JOIN users u ON u.id = so.user_id LEFT JOIN user_events ue ON ue.id = so.related_event_id WHERE so.active = 1 AND date(so.delivery_date) <= date(?)'
  ).all(today);

  rows.forEach(r => {
    try {
      // Send greeting for special event deliveries
      if (r.delivery_type === 'special_event' && r.event_type) {
        const to = r.user_email || process.env.ADMIN_EMAIL;
        if (to) {
          const greeting = formatGreeting(r.event_type, r.relation, r.event_name);
          const subject = `Special Greeting: ${r.event_type.replace('_', ' ')}`;
          const greetingText = `${greeting}\n\nA special gift has been scheduled for delivery today!`;
          sendEmail(to, subject, greetingText).catch(err => 
            console.error(`Failed to send greeting email to ${to}:`, err.message)
          );
          console.log(`Sent greeting for event ${r.event_type} to ${r.username}`);
        }
      }

      const cart = JSON.parse(r.cart_snapshot);
      let total = 0;
      const info = db.prepare('INSERT INTO orders (user_id, total) VALUES (?, ?)').run(r.user_id, 0);
      const orderId = info.lastInsertRowid;
      cart.forEach(item => {
        const p = db.prepare('SELECT price FROM products WHERE id = ?').get(item.product_id);
        const price = p ? p.price : 0;
        total += price * (item.quantity || 1);
        db.prepare('INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)').run(orderId, item.product_id, item.quantity || 1, price);
      });
      db.prepare('UPDATE orders SET total = ? WHERE id = ?').run(total, orderId);
      db.prepare('UPDATE scheduled_orders SET active = 0 WHERE id = ?').run(r.id);
      
      const to = r.user_email || process.env.ADMIN_EMAIL;
      if (to) {
        let deliveryType = 'scheduled delivery';
        if (r.delivery_type === 'same_day') deliveryType = 'same-day delivery';
        if (r.delivery_type === 'special_event') deliveryType = `special event delivery (${r.event_type})`;
        
        const subject = `Your ${deliveryType} order has been processed!`;
        const cartItems = cart.map(item => `  - ${item.name} (Qty: ${item.quantity})`).join('\n');
        const text = `Hello ${r.username},\n\nYour ${deliveryType} order #${orderId} has been processed!\n\nItems:\n${cartItems}\n\nTotal: $${total.toFixed(2)}${r.description ? `\n\nNotes: ${r.description}` : ''}\n\nThank you for your order!\n\nBest regards,\nFancyStore Team`;
        sendEmail(to, subject, text).catch(err => console.error('scheduled order email failed', err.message));
      }
      console.log(`Processed scheduled order ${r.id} (${r.delivery_type}) -> order ${orderId}`);
    } catch (e) {
      console.error('Failed to process scheduled order', r.id, e.message);
    }
  });
}

function processOnce() {
  const now = new Date().toISOString();
  const rows = db.prepare('SELECT ro.*, u.email as user_email, u.username FROM recurring_orders ro JOIN users u ON u.id = ro.user_id WHERE ro.active = 1 AND ro.next_run <= ?').all(now);
  if (rows.length) {
    rows.forEach(r => {
      try {
        const cart = JSON.parse(r.cart_snapshot);
        let total = 0;
        const info = db.prepare('INSERT INTO orders (user_id, total) VALUES (?, ?)').run(r.user_id, 0);
        const orderId = info.lastInsertRowid;
        cart.forEach(item => {
          const p = db.prepare('SELECT price FROM products WHERE id = ?').get(item.product_id);
          const price = p ? p.price : 0;
          total += price * (item.quantity || 1);
          db.prepare('INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)').run(orderId, item.product_id, item.quantity || 1, price);
        });
        db.prepare('UPDATE orders SET total = ? WHERE id = ?').run(total, orderId);
        const next = addInterval(r.next_run, r.interval);
        db.prepare('UPDATE recurring_orders SET next_run = ? WHERE id = ?').run(next, r.id);
        const to = r.user_email || process.env.ADMIN_EMAIL;
        if (to) {
          const subject = `Recurring order processed for ${r.username || 'user'}`;
          const text = `Order ${orderId} was created for recurring schedule ${r.interval}. Total: ${total}`;
          sendEmail(to, subject, text).catch(e => console.error('email failed', e.message));
        }
        console.log(`Processed recurring order ${r.id} -> order ${orderId}`);
      } catch (e) {
        console.error('Failed to process recurring', r.id, e.message);
      }
    });
  } else {
    console.log('No recurring orders to process');
  }
  processScheduledOrders();
  processUserEvents();
}

if (require.main === module) {
  processOnce();
}

module.exports = { processOnce };
