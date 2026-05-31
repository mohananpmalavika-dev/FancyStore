const request = require('supertest');
const { expect } = require('chai');
const app = require('../src/index');

describe('Email test endpoint', function() {
  it('rejects unauthenticated requests', async function() {
    const res = await request(app).post('/email/test').send({ to: 'x@example.com' });
    expect(res.status).to.equal(401);
  });

  it('validates required fields when authenticated', async function() {
    // login as seeded admin
    const login = await request(app).post('/auth/login').send({ username: 'admin', password: 'adminpass' });
    expect(login.status).to.equal(200);
    const token = login.body.token;
    const res = await request(app).post('/email/test').set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).to.equal(400);
  });
});
