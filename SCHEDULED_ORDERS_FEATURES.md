# Scheduled Orders & Special Date Delivery Features

## Overview
The FancyStore platform now supports advanced scheduled order capabilities with special date delivery and automated greeting notifications for customer milestones.

## Features

### 1. **Scheduled Orders with Multiple Delivery Types**

#### Delivery Types:
- **`standard`** - Traditional scheduled delivery on a specific date
- **`same_day`** - Immediate same-day delivery (delivery_date auto-set to today)
- **`special_event`** - Delivery on customer's special dates (birthdays, anniversaries, etc.)

### 2. **Customer Event Management**

Store and track important dates for customers:
- **`birthday`** - Customer's birthday
- **`anniversary`** - Wedding/relationship anniversary
- **`spouse_birthday`** - Spouse's birthday
- **`child_birthday`** - Child's birthday

### 3. **Automated Greetings & Notifications**

- Automatic greeting emails sent on special dates
- Notification that gift delivery is being processed
- Email includes personalized greeting and order details

## API Endpoints

### Customer Events

#### List Customer Events
```bash
GET /events
Authorization: Bearer <token>
```
Response:
```json
[
  {
    "id": 1,
    "user_id": 2,
    "type": "birthday",
    "relation": null,
    "name": "John",
    "event_date": "1995-03-15",
    "last_notified_year": 2025,
    "created_at": "2025-05-30T10:00:00.000Z"
  }
]
```

#### Create Customer Event
```bash
POST /events
Authorization: Bearer <token>
Content-Type: application/json

{
  "type": "birthday",
  "relation": null,
  "name": "John",
  "event_date": "1995-03-15T00:00:00Z"
}
```

**Parameters:**
- `type` (required): One of `birthday`, `anniversary`, `spouse_birthday`, `child_birthday`
- `event_date` (required): ISO 8601 date format
- `relation` (optional): Relationship description (e.g., "spouse", "son", "daughter")
- `name` (optional): Event name or person's name

#### Delete Customer Event
```bash
DELETE /events/{eventId}
Authorization: Bearer <token>
```

### Scheduled Orders

#### List Scheduled Orders
```bash
GET /scheduled
Authorization: Bearer <token>
```

#### Create Scheduled Order

**Standard Delivery:**
```bash
POST /scheduled
Authorization: Bearer <token>
Content-Type: application/json

{
  "cart_snapshot": [
    {
      "product_id": 1,
      "name": "Gold-plated Necklace",
      "quantity": 2,
      "price": 199.99
    }
  ],
  "delivery_date": "2026-06-15T00:00:00Z",
  "description": "Anniversary gift",
  "delivery_type": "standard"
}
```

**Same-Day Delivery:**
```bash
POST /scheduled
Authorization: Bearer <token>
Content-Type: application/json

{
  "cart_snapshot": [
    {
      "product_id": 3,
      "name": "Deluxe Teddy Bear",
      "quantity": 1,
      "price": 29.99
    }
  ],
  "delivery_type": "same_day"
}
```
*Note: `delivery_date` is optional for same_day (auto-set to today)*

**Special Event Delivery:**
```bash
POST /scheduled
Authorization: Bearer <token>
Content-Type: application/json

{
  "cart_snapshot": [
    {
      "product_id": 5,
      "name": "Silk Premium Dress",
      "quantity": 1,
      "price": 299.99
    }
  ],
  "delivery_type": "special_event",
  "related_event_id": 1,
  "description": "Birthday surprise"
}
```

**Parameters:**
- `cart_snapshot` (required): Array of items with product_id, name, quantity
- `delivery_date` (optional for same_day/special_event): ISO 8601 format
- `delivery_type` (optional): `standard` (default), `same_day`, or `special_event`
- `related_event_id` (required for special_event): ID from customer events
- `description` (optional): Order notes

#### Update Scheduled Order
```bash
PUT /scheduled/{orderId}
Authorization: Bearer <token>
Content-Type: application/json

{
  "description": "Updated notes",
  "delivery_type": "special_event",
  "related_event_id": 2
}
```

#### Delete Scheduled Order
```bash
DELETE /scheduled/{orderId}
Authorization: Bearer <token>
```

## Database Schema

### user_events Table
```sql
CREATE TABLE user_events (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL, -- 'birthday','anniversary','spouse_birthday','child_birthday'
  relation TEXT,
  name TEXT,
  event_date TEXT NOT NULL,
  last_notified_year INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
```

### scheduled_orders Table
```sql
CREATE TABLE scheduled_orders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  cart_snapshot TEXT NOT NULL,
  delivery_date TEXT NOT NULL,
  description TEXT,
  delivery_type TEXT DEFAULT 'standard', -- 'standard' | 'same_day' | 'special_event'
  related_event_id INTEGER,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(related_event_id) REFERENCES user_events(id)
);
```

### users Table Extension
```sql
ALTER TABLE users ADD COLUMN email TEXT;
```

## Cron Job Processing

The system includes automated cron jobs that:

1. **Check for orders due today** - Runs every hour
2. **Process scheduled orders** - Creates order records and processes inventory
3. **Send greeting emails** - For special event deliveries
4. **Send delivery notifications** - Confirms order processing to customer

### Running the Scheduler
```bash
node scripts/run_recurring_cron.js
```

This will:
- Start a cron job that runs every hour at minute 0
- Process all recurring orders due
- Process all scheduled orders due today
- Send event greeting emails if today matches customer milestones

## Usage Examples

### Example 1: Birthday Gift Delivery

1. **Add customer's birthday:**
```bash
POST /events
{
  "type": "birthday",
  "name": "Sarah",
  "event_date": "1992-07-20T00:00:00Z"
}
```

2. **Create scheduled order for birthday delivery:**
```bash
POST /scheduled
{
  "cart_snapshot": [
    {
      "product_id": 5,
      "name": "Silk Premium Dress",
      "quantity": 1,
      "price": 299.99
    }
  ],
  "delivery_type": "special_event",
  "related_event_id": 1,
  "description": "Birthday gift for Sarah"
}
```

3. **On birthday:** Cron job automatically:
   - Sends greeting email: "Happy Birthday, Sarah!"
   - Sends order processing email
   - Creates order and processes inventory

### Example 2: Anniversary Delivery

1. **Add anniversary date:**
```bash
POST /events
{
  "type": "anniversary",
  "name": "Our Anniversary",
  "event_date": "2000-06-15T00:00:00Z"
}
```

2. **Create anniversary delivery:**
```bash
POST /scheduled
{
  "cart_snapshot": [
    {
      "product_id": 1,
      "name": "Gold-plated Necklace",
      "quantity": 1,
      "price": 199.99
    }
  ],
  "delivery_type": "special_event",
  "related_event_id": 2,
  "description": "Anniversary gift"
}
```

### Example 3: Same-Day Delivery
```bash
POST /scheduled
{
  "cart_snapshot": [
    {
      "product_id": 3,
      "name": "Deluxe Teddy Bear",
      "quantity": 2,
      "price": 29.99
    }
  ],
  "delivery_type": "same_day",
  "description": "Urgent gift needed today"
}
```

## Email Notifications

### Special Event Greeting Email
**Subject:** Special Greeting: birthday
**Body:**
```
Happy Birthday, Sarah! Wishing you a wonderful year ahead.

A special gift has been scheduled for delivery today!
```

### Order Processing Email
**Subject:** Your special event delivery order has been processed!
**Body:**
```
Hello [username],

Your special event delivery order #[orderId] has been processed!

Items:
  - Silk Premium Dress (Qty: 1)

Total: $299.99

Notes: Birthday gift for Sarah

Thank you for your order!

Best regards,
FancyStore Team
```

## Implementation Notes

- Cron jobs require Node.js cron-based scheduler running continuously
- Email notifications require SMTP configuration (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS)
- User email must be set in the users table for notifications to work
- Greetings are sent once per year (tracked by last_notified_year)
- Same-day orders auto-process if delivery_date is today or earlier
- Special event deliveries automatically use the event's event_date

## Future Enhancements

- SMS notifications for delivery confirmations
- Multi-language greeting templates
- Gift wrapping and personalization options
- Recurring special event deliveries (annual birthdays)
- Advanced scheduling (delivery windows, time slots)
