const path = require('path');
const Database = require('better-sqlite3');
const sendEmail = require('../src/utils/email');

const dbPath = path.resolve(__dirname, '..', 'fancystore.db');
const db = new Database(dbPath);

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

function sendGreetingEmail(userId, eventId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user || !user.email) return;

  const event = db.prepare('SELECT * FROM user_events WHERE id = ?').get(eventId);
  if (!event) return;

  const subject = `Special Greeting: ${event.type.replace('_', ' ')}`;
  const greeting = formatGreeting(event.type, event.relation, event.name);
  const text = `${greeting}\n\nSpecial gift has been scheduled for delivery today!`;
  
  sendEmail(user.email, subject, text).catch(err => 
    console.error(`Failed to send greeting email to ${user.email}:`, err.message)
  );
}

function processScheduledOrders() {
  const today = new Date().toISOString().split('T')[0];
  
  // Get all scheduled orders due today
  const dueTodayOrders = db.prepare(
    'SELECT so.*, u.username, u.email FROM scheduled_orders so JOIN users u ON u.id = so.user_id WHERE DATE(so.delivery_date) = ? AND so.active = 1'
  ).all(today);

  console.log(`[${new Date().toISOString()}] Processing ${dueTodayOrders.length} scheduled orders due today`);

  dueTodayOrders.forEach(order => {
    console.log(`  - Order ${order.id} for user ${order.username} (${order.delivery_type})`);

    // Send greeting for special event deliveries
    if (order.delivery_type === 'special_event' && order.related_event_id) {
      sendGreetingEmail(order.user_id, order.related_event_id);
    }

    // Send delivery notification
    if (order.email) {
      const cartData = JSON.parse(order.cart_snapshot);
      const itemsText = cartData.map(item => `  - ${item.name} (Qty: ${item.quantity})`).join('\n');
      const subject = 'Your Scheduled Delivery is Being Processed Today!';
      const text = `Hello ${order.username},\n\nYour scheduled order is being processed for delivery today!\n\nItems in your order:\n${itemsText}${order.description ? `\n\nNotes: ${order.description}` : ''}\n\nThank you for your order!\n\nBest regards,\nFancyStore Team`;
      
      sendEmail(order.email, subject, text).catch(err =>
        console.error(`Failed to send delivery notification to ${order.email}:`, err.message)
      );
    }
  });

  return dueTodayOrders.length;
}

module.exports = { processScheduledOrders, sendGreetingEmail };

// Run if called directly
if (require.main === module) {
  processScheduledOrders();
}
