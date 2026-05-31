const jwt = require('jsonwebtoken');
const db = require('../db');

function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader ? authHeader.split(' ')[1] : req.cookies && req.cookies.auth_token;
  if (!token) {
    if (req.originalUrl && req.originalUrl.startsWith('/admin')) {
      return res.redirect('/admin/login');
    }
    return res.status(401).json({ error: 'missing token' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'change-me');
    // attach minimal user
    req.user = { id: payload.id, username: payload.username, email: payload.email, role: payload.role };
    next();
  } catch (err) {
    if (req.originalUrl && req.originalUrl.startsWith('/admin')) {
      res.clearCookie('auth_token');
      return res.redirect('/admin/login');
    }
    res.status(401).json({ error: 'invalid token' });
  }
}

function authorizeRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'not authenticated' });
    if (!allowedRoles.includes(req.user.role)) {
      if (req.originalUrl && req.originalUrl.startsWith('/admin')) {
        return res.status(403).send('Forbidden');
      }
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };
}

module.exports = { authenticateJWT, authorizeRole };
