const express = require('express');
const router = express.Router();
const scheduled = require('../controllers/scheduledOrderController');
const auth = require('../middleware/auth');
const { body, param, validationResult } = require('express-validator');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
};

router.get('/', auth.authenticateJWT, scheduled.list);

router.post('/', auth.authenticateJWT,
  body('cart_snapshot').isArray({ min: 1 }),
  body('delivery_date').isISO8601(),
  body('delivery_type').optional().isIn(['standard', 'same_day', 'special_event']),
  body('related_event_id').optional().isInt(),
  validate,
  scheduled.create);

router.put('/:id', auth.authenticateJWT,
  param('id').isInt(),
  body('delivery_type').optional().isIn(['standard', 'same_day', 'special_event']),
  body('related_event_id').optional().isInt(),
  validate,
  scheduled.update);

router.delete('/:id', auth.authenticateJWT, 
  param('id').isInt(), 
  validate, 
  scheduled.remove);

module.exports = router;