const request = require('supertest');
const { expect } = require('chai');
const app = require('../src/index');
const db = require('../src/db');
const { getStoreProfile, updateStoreProfile } = require('../src/utils/storeProfile');

function csrfToken(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  return match && match[1];
}

describe('Storefront flow', function() {
  it('shows an admin link on the shop header for logged-in admins', async function() {
    const agent = request.agent(app);
    const loginPage = await agent.get('/admin/login');
    const token = csrfToken(loginPage.text);
    expect(loginPage.status).to.equal(200);
    expect(token).to.be.a('string');

    const login = await agent
      .post(`/admin/login?_csrf=${encodeURIComponent(token)}`)
      .type('form')
      .send({ username: 'admin', password: 'adminpass' });
    expect(login.status).to.equal(302);

    const shop = await agent.get('/shop');
    expect(shop.status).to.equal(200);
    expect(shop.text).to.include('href="/admin">Admin</a>');
  });

  it('lets admins update store contact details shown on the storefront', async function() {
    const previousProfile = getStoreProfile();
    const agent = request.agent(app);
    const loginPage = await agent.get('/admin/login');
    const loginToken = csrfToken(loginPage.text);
    expect(loginPage.status).to.equal(200);
    expect(loginToken).to.be.a('string');

    const login = await agent
      .post(`/admin/login?_csrf=${encodeURIComponent(loginToken)}`)
      .type('form')
      .send({ username: 'admin', password: 'adminpass' });
    expect(login.status).to.equal(302);

    const settingsPage = await agent.get('/admin/settings');
    const settingsToken = csrfToken(settingsPage.text);
    expect(settingsPage.status).to.equal(200);
    expect(settingsPage.text).to.include('Store Settings');
    expect(settingsToken).to.be.a('string');

    const suffix = Date.now();
    const profile = {
      address: `Golden Crown Road ${suffix}, Kochi`,
      email: `contact${suffix}@goldencrown.test`,
      phone: `+91 98765 ${String(suffix).slice(-5)}`,
      upi_id: `goldencrown${suffix}@upi`,
    };

    try {
      const update = await agent
        .post('/admin/settings')
        .type('form')
        .send({ _csrf: settingsToken, ...profile });
      expect(update.status).to.equal(302);

      const refreshedSettings = await agent.get('/admin/settings');
      expect(refreshedSettings.text).to.include(profile.upi_id);

      const home = await request(app).get('/');
      expect(home.text).to.include(profile.address);
      expect(home.text).to.include(profile.email);
      expect(home.text).to.include(profile.phone);
    } finally {
      updateStoreProfile(previousProfile);
    }
  });

  it('supports WhatsApp contact links, contact messages, and testimonials', async function() {
    const previousProfile = getStoreProfile();
    const agent = request.agent(app);
    const suffix = Date.now();
    const contactMessage = `Need bridal collection details ${suffix}`;
    const feedbackMessage = `Beautiful collection and helpful service ${suffix}`;

    try {
      updateStoreProfile({
        address: 'Golden Crown Road, Kochi',
        email: 'store@goldencrown.test',
        phone: '+91 98765 43210',
      });

      const contactPage = await agent.get('/contact');
      const contactToken = csrfToken(contactPage.text);
      expect(contactPage.status).to.equal(200);
      expect(contactPage.text).to.include('href="https://wa.me/919876543210"');
      expect(contactToken).to.be.a('string');

      const contact = await agent
        .post('/contact')
        .type('form')
        .send({
          _csrf: contactToken,
          name: 'Contact Customer',
          email: `contact${suffix}@example.com`,
          phone: '9999999999',
          message: contactMessage,
        });
      expect(contact.status).to.equal(302);
      const savedContact = db.prepare('SELECT * FROM contact_messages WHERE message = ?').get(contactMessage);
      expect(savedContact).to.include({ name: 'Contact Customer' });

      const feedbackPage = await agent.get('/feedback');
      const feedbackToken = csrfToken(feedbackPage.text);
      expect(feedbackPage.status).to.equal(200);
      expect(feedbackToken).to.be.a('string');

      const feedback = await agent
        .post('/feedback')
        .type('form')
        .send({
          _csrf: feedbackToken,
          name: 'Happy Customer',
          email: `feedback${suffix}@example.com`,
          rating: '5',
          message: feedbackMessage,
          display_as_testimonial: '1',
        });
      expect(feedback.status).to.equal(302);

      const testimonials = await agent.get('/testimonials');
      expect(testimonials.status).to.equal(200);
      expect(testimonials.text).to.include(feedbackMessage);
      expect(testimonials.text).to.include('Happy Customer');
    } finally {
      db.prepare('DELETE FROM contact_messages WHERE message = ?').run(contactMessage);
      db.prepare('DELETE FROM feedback WHERE message = ?').run(feedbackMessage);
      updateStoreProfile(previousProfile);
    }
  });

  it('renders UPI checkout, requires UTR, and shows UTR on customer and admin pages', async function() {
    const previousProfile = getStoreProfile();
    const suffix = Date.now();
    const email = `upi-render-${suffix}@example.com`;
    const utr = `QAUTR${suffix}`;
    let productId;
    let userId;
    let orderId;

    try {
      updateStoreProfile({ ...previousProfile, upi_id: 'goldencrownqa@upi' });
      const productInfo = db.prepare('INSERT INTO products (name, category, price, stock, description) VALUES (?, ?, ?, ?, ?)')
        .run(`UPI Render Product ${suffix}`, 'ornaments', 99, 3, 'render validation product');
      productId = productInfo.lastInsertRowid;

      const agent = request.agent(app);
      const registerPage = await agent.get('/register');
      const registerToken = csrfToken(registerPage.text);
      expect(registerPage.status).to.equal(200);
      expect(registerToken).to.be.a('string');

      const register = await agent
        .post('/register')
        .type('form')
        .send({
          _csrf: registerToken,
          name: 'UPI Render Customer',
          email,
          password: 'secret123',
          next: '/shop',
        });
      expect(register.status).to.equal(302);
      userId = db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;

      const shopPage = await agent.get('/shop');
      const shopToken = csrfToken(shopPage.text);
      expect(shopToken).to.be.a('string');

      const addToBag = await agent
        .post('/shop/cart-items')
        .type('form')
        .send({
          _csrf: shopToken,
          product_id: productId,
          quantity: 1,
          redirect_to: '/bag',
        });
      expect(addToBag.status).to.equal(302);

      const bagPage = await agent.get('/bag');
      const bagToken = csrfToken(bagPage.text);
      expect(bagPage.status).to.equal(200);
      expect(bagPage.text).to.include('value="upi"');
      expect(bagPage.text).to.include('data-payment-utr');
      expect(bagPage.text).to.include('goldencrownqa@upi');
      expect(bagPage.text).to.include('upi://pay?pa=goldencrownqa%40upi');
      expect(bagPage.text).to.include('am=99.00');
      expect(bagPage.text).to.include('Pay with any UPI app');
      expect(bagToken).to.be.a('string');

      const missingUtr = await agent
        .post('/bag/checkout')
        .type('form')
        .send({
          _csrf: bagToken,
          customer_name: 'UPI Render Customer',
          customer_email: email,
          customer_phone: '9999999999',
          delivery_address: '12 Render Street',
          delivery_city: 'Kochi',
          delivery_pincode: '682001',
          payment_method: 'upi',
        });
      expect(missingUtr.status).to.equal(302);
      expect(missingUtr.headers.location).to.include('Enter+the+UPI+UTR');

      const retryBag = await agent.get('/bag');
      const retryToken = csrfToken(retryBag.text);
      const checkout = await agent
        .post('/bag/checkout')
        .type('form')
        .send({
          _csrf: retryToken,
          customer_name: 'UPI Render Customer',
          customer_email: email,
          customer_phone: '9999999999',
          delivery_address: '12 Render Street',
          delivery_city: 'Kochi',
          delivery_pincode: '682001',
          payment_method: 'upi',
          payment_utr: utr,
        });
      expect(checkout.status).to.equal(302);
      expect(checkout.headers.location).to.match(/^\/orders\/\d+$/);
      orderId = Number(checkout.headers.location.split('/').pop());

      const orderPage = await agent.get(checkout.headers.location);
      expect(orderPage.status).to.equal(200);
      expect(orderPage.text).to.include(utr);

      const anonymousSettings = await request(app).get('/admin/settings');
      expect(anonymousSettings.status).to.equal(302);
      expect(anonymousSettings.headers.location).to.equal('/admin/login');

      const adminAgent = request.agent(app);
      const loginPage = await adminAgent.get('/admin/login');
      const loginToken = csrfToken(loginPage.text);
      const adminLogin = await adminAgent
        .post(`/admin/login?_csrf=${encodeURIComponent(loginToken)}`)
        .type('form')
        .send({ username: 'admin', password: 'adminpass' });
      expect(adminLogin.status).to.equal(302);

      const orders = await adminAgent.get('/admin/orders');
      expect(orders.status).to.equal(200);
      expect(orders.text).to.include(`UTR: ${utr}`);
    } finally {
      if (orderId) db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
      if (orderId) db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
      if (userId) {
        const cart = db.prepare('SELECT id FROM carts WHERE user_id = ?').get(userId);
        if (cart) db.prepare('DELETE FROM cart_items WHERE cart_id = ?').run(cart.id);
        db.prepare('DELETE FROM carts WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      }
      if (productId) db.prepare('DELETE FROM products WHERE id = ?').run(productId);
      updateStoreProfile(previousProfile);
    }
  });

  it('renders shopping pages and creates a delivery order for a customer', async function() {
    const home = await request(app).get('/');
    expect(home.status).to.equal(200);
    expect(home.text).to.include('The Golden Crown');
    expect(home.text).to.include('Rs ');
    expect(home.text).to.not.include('$');

    const shop = await request(app).get('/shop');
    expect(shop.status).to.equal(200);
    expect(shop.text).to.include('Shop The Golden Crown');

    const adminLogin = await request(app).post('/auth/login').send({ username: 'admin', password: 'adminpass' });
    expect(adminLogin.status).to.equal(200);

    const productName = `Test Checkout Product ${Date.now()}`;
    const product = await request(app)
      .post('/products')
      .set('Authorization', `Bearer ${adminLogin.body.token}`)
      .send({ name: productName, category: 'tests', price: 12.5, stock: 8, description: 'checkout regression product' });
    expect(product.status).to.equal(201);

    const email = `checkout${Date.now()}@gmail.com`;
    const password = 'secret123';
    const register = await request(app).post('/auth/register').send({ email, password });
    expect(register.status).to.equal(201);

    const login = await request(app).post('/auth/login').send({ login: email, password });
    expect(login.status).to.equal(200);

    const addItem = await request(app)
      .post('/cart/items')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ product_id: product.body.id, quantity: 2 });
    expect(addItem.status).to.equal(200);
    expect(addItem.body.items).to.have.length(1);

    const checkout = await request(app)
      .post('/cart/checkout')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({
        customer_name: 'Checkout Customer',
        customer_email: email,
        customer_phone: '9999999999',
        delivery_address: '12 Fancy Street',
        delivery_city: 'Kochi',
        delivery_pincode: '682001',
        delivery_date: '2026-06-05',
        payment_method: 'upi',
        payment_utr: 'UTR123456789',
      });

    expect(checkout.status).to.equal(201);
    expect(checkout.body).to.include({
      customer_name: 'Checkout Customer',
      delivery_address: '12 Fancy Street',
      status: 'new',
      payment_method: 'upi',
      payment_utr: 'UTR123456789',
    });
    expect(checkout.body.total).to.be.greaterThan(0);

    const adminAgent = request.agent(app);
    const loginPage = await adminAgent.get('/admin/login');
    const loginToken = csrfToken(loginPage.text);
    const adminUiLogin = await adminAgent
      .post(`/admin/login?_csrf=${encodeURIComponent(loginToken)}`)
      .type('form')
      .send({ username: 'admin', password: 'adminpass' });
    expect(adminUiLogin.status).to.equal(302);

    const orders = await adminAgent.get('/admin/orders');
    expect(orders.status).to.equal(200);
    expect(orders.text).to.include('UTR: UTR123456789');
  });
});
