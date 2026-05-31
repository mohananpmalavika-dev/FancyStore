const request = require('supertest');
const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const app = require('../src/index');

function csrfToken(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  return match && match[1];
}

describe('Products API', function() {
  it('lists products', async function() {
    const res = await request(app).get('/products');
    expect(res.status).to.equal(200);
    expect(res.body).to.be.an('array');
  });

  it('get product by id', async function() {
    const res = await request(app).get('/products/1');
    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('id');
  });

  it('allows admin to create product', async function() {
    const login = await request(app).post('/auth/login').send({ username: 'admin', password: 'adminpass' });
    expect(login.status).to.equal(200);
    const token = login.body.token;
    const payload = {
      name: 'Test Product',
      category: 'tests',
      price: 1.23,
      stock: 5,
      description: 'created-by-test',
      images: ['/assets/ornaments.png', '/assets/toys.png', '/assets/gifts.png', '/assets/dresses.png'],
    };
    const res = await request(app).post('/products').set('Authorization', `Bearer ${token}`).send(payload);
    expect(res.status).to.equal(201);
    expect(res.body).to.include({ name: 'Test Product' });
    expect(res.body.images).to.deep.equal(payload.images);
  });

  it('allows admin UI to attach product image files', async function() {
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

    const productPage = await agent.get('/admin/products/new');
    const productToken = csrfToken(productPage.text);
    expect(productPage.status).to.equal(200);
    expect(productToken).to.be.a('string');
    expect(productPage.text).to.include('Price (Rs)');

    const productName = `Test Upload Product ${Date.now()}`;
    const create = await agent
      .post(`/admin/products?_csrf=${encodeURIComponent(productToken)}`)
      .field('name', productName)
      .field('category', 'tests')
      .field('price', '9.99')
      .field('stock', '4')
      .field('description', 'created with an attached image')
      .attach('image_1_file', path.join(__dirname, '..', 'src', 'public', 'assets', 'ornaments.png'));

    expect(create.status).to.equal(302);

    const products = await request(app).get('/products');
    const created = products.body.find(product => product.name === productName);
    expect(created).to.exist;
    expect(created.images).to.have.length(1);
    expect(created.images[0]).to.match(/^\/uploads\/products\//);

    const uploadedPath = path.join(__dirname, '..', 'src', 'public', created.images[0].replace(/^\/+/, ''));
    if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
  });
});
