const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const dbPath = process.env.SQLITE_DB_PATH
  ? path.resolve(process.env.SQLITE_DB_PATH)
  : path.resolve(__dirname, '..', 'fancystore.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

// Initialize tables
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT,
  price REAL DEFAULT 0,
  stock INTEGER DEFAULT 0,
  description TEXT,
  image_urls TEXT
);

CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  buy INTEGER DEFAULT 0,
  free INTEGER DEFAULT 0,
  percent REAL DEFAULT 0,
  hour INTEGER,
  starts_at TEXT,
  ends_at TEXT,
  active INTEGER DEFAULT 1,
  FOREIGN KEY(product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS carts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cart_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cart_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity INTEGER DEFAULT 1,
  FOREIGN KEY(cart_id) REFERENCES carts(id),
  FOREIGN KEY(product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, product_id),
  FOREIGN KEY(product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS recurring_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  cart_snapshot TEXT NOT NULL,
  interval TEXT NOT NULL,
  next_run TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scheduled_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  cart_snapshot TEXT NOT NULL,
  delivery_date TEXT NOT NULL,
  description TEXT,
  delivery_type TEXT DEFAULT 'standard',
  related_event_id INTEGER,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(related_event_id) REFERENCES user_events(id)
);

CREATE TABLE IF NOT EXISTS user_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  relation TEXT,
  name TEXT,
  event_date TEXT NOT NULL,
  last_notified_year INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  total REAL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity INTEGER DEFAULT 1,
  price REAL DEFAULT 0,
  FOREIGN KEY(order_id) REFERENCES orders(id),
  FOREIGN KEY(product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS store_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  address TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  upi_id TEXT DEFAULT '',
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  message TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  rating INTEGER DEFAULT 5,
  message TEXT NOT NULL,
  display_as_testimonial INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

try {
  const info = db.prepare("PRAGMA table_info('users')").all();
  const hasEmail = info.some(c => c.name === 'email');
  if (!hasEmail) {
    db.prepare('ALTER TABLE users ADD COLUMN email TEXT').run();
  }
} catch (e) {
  // ignore on read-only or other environments
}

function addColumnIfMissing(table, column, definition) {
  try {
    const info = db.prepare(`PRAGMA table_info('${table}')`).all();
    const exists = info.some(c => c.name === column);
    if (!exists) db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  } catch (e) {
    // ignore on read-only or other environments
  }
}

addColumnIfMissing('orders', 'status', "TEXT DEFAULT 'new'");
addColumnIfMissing('orders', 'customer_name', 'TEXT');
addColumnIfMissing('orders', 'customer_email', 'TEXT');
addColumnIfMissing('orders', 'customer_phone', 'TEXT');
addColumnIfMissing('orders', 'delivery_address', 'TEXT');
addColumnIfMissing('orders', 'delivery_city', 'TEXT');
addColumnIfMissing('orders', 'delivery_pincode', 'TEXT');
addColumnIfMissing('orders', 'delivery_note', 'TEXT');
addColumnIfMissing('orders', 'delivery_date', 'TEXT');
addColumnIfMissing('orders', 'payment_method', "TEXT DEFAULT 'pay_on_delivery'");
addColumnIfMissing('orders', 'payment_utr', 'TEXT');
addColumnIfMissing('orders', 'subtotal', 'REAL DEFAULT 0');
addColumnIfMissing('orders', 'discount_total', 'REAL DEFAULT 0');
addColumnIfMissing('orders', 'delivery_fee', 'REAL DEFAULT 0');
addColumnIfMissing('orders', 'updated_at', 'TEXT');
addColumnIfMissing('order_items', 'product_name', 'TEXT');
addColumnIfMissing('order_items', 'line_total', 'REAL DEFAULT 0');
addColumnIfMissing('products', 'image_urls', 'TEXT');
addColumnIfMissing('store_settings', 'upi_id', "TEXT DEFAULT ''");

try {
  db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email) WHERE email IS NOT NULL').run();
} catch (e) {
  // existing duplicate emails should not block local development
}

// Seed default users if none
const userCount = db.prepare('SELECT COUNT(1) as c FROM users').get().c;
if (userCount === 0) {
  const insert = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)');
  const adminPass = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'adminpass', 10);
  const stockPass = bcrypt.hashSync(process.env.STOCK_MANAGER_PASSWORD || 'stockpass', 10);
  insert.run(process.env.ADMIN_USERNAME || 'admin', adminPass, 'admin');
  insert.run('stockmgr', stockPass, 'stock_manager');
}

// Seed products if none
const prodCount = db.prepare('SELECT COUNT(1) as c FROM products').get().c;
if (prodCount === 0) {
  const insert = db.prepare('INSERT INTO products (name, category, price, stock, description) VALUES (?, ?, ?, ?, ?)');
  insert.run('Gold-plated Necklace', 'ornaments', 199.99, 10, 'Elegant gold-plated necklace.');
  insert.run('Gold Rim Bracelet', 'ornaments', 89.5, 15, 'Delicate bracelet with gold rim.');
  insert.run('Deluxe Teddy Bear', 'toys', 29.99, 40, 'Premium plush teddy.');
  insert.run('Kids Building Set', 'toys', 45.0, 25, 'Educational building blocks.');
  insert.run('Silk Premium Dress', 'premium dresses', 299.99, 5, 'Luxury silk dress.');
  insert.run('Evening Gown', 'premium dresses', 499.0, 3, 'Designer evening gown.');
  insert.run('Designer Gift Box', 'gift items', 59.99, 20, 'Curated gift box.');
  insert.run('Golden Cosmetic Kit', 'cosmetics', 79.99, 30, 'Limited edition cosmetic kit.');
}

db.prepare(`
  INSERT OR IGNORE INTO store_settings (id, address, email, phone, updated_at)
  VALUES (1, '', ?, '', ?)
`).run(process.env.ADMIN_EMAIL || '', new Date().toISOString());

module.exports = db;
