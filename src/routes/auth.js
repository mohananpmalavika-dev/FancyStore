const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

router.post('/register', (req, res) => {
  const { password, email, role } = req.body;
  let { username } = req.body;
  if (!username && email) username = String(email).split('@')[0];
  if (!username || !password) return res.status(400).json({ error: 'username/email and password required' });
  // Only allow role assignment when caller is an admin with a valid token.
  let assignedRole = 'customer';
  if (role) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(403).json({ error: 'role assignment forbidden' });
    const token = authHeader.split(' ')[1];
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET || 'change-me');
      if (payload.role === 'admin') {
        assignedRole = role;
      } else {
        return res.status(403).json({ error: 'only admin may assign roles' });
      }
    } catch (err) {
      return res.status(401).json({ error: 'invalid token for role assignment' });
    }
  }
  const hashed = bcrypt.hashSync(password, 10);
  try {
    const stmt = db.prepare('INSERT INTO users (username, password, role, email) VALUES (?, ?, ?, ?)');
    const info = stmt.run(username, hashed, assignedRole, email || null);
    const user = db.prepare('SELECT id, username, role, email FROM users WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(user);
  } catch (err) {
    res.status(400).json({ error: 'user exists or invalid' });
  }
});

router.post('/login', (req, res) => {
  const login = req.body.login || req.body.email || req.body.username;
  const { password } = req.body;
  if (!login || !password) return res.status(400).json({ error: 'email/username and password required' });
  const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(login, login);
  if (!user) return res.status(401).json({ error: 'invalid credentials' });
  const ok = bcrypt.compareSync(password, user.password);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });
  const payload = { id: user.id, username: user.username, email: user.email, role: user.role };
  const token = jwt.sign(payload, process.env.JWT_SECRET || 'change-me', { expiresIn: '8h' });
  res.json({ token });
});

module.exports = router;
