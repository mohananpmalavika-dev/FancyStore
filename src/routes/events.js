const express = require('express');
const router = express.Router();
const eventCtrl = require('../controllers/eventController');
const auth = require('../middleware/auth');
const { body, param, validationResult } = require('express-validator');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
};

router.get('/', auth.authenticateJWT, eventCtrl.list);
router.post('/', auth.authenticateJWT,
  body('type').isIn(['birthday','anniversary','spouse_birthday','child_birthday']),
  body('event_date').isISO8601(),
  validate,
  eventCtrl.create);
router.delete('/:id', auth.authenticateJWT, param('id').isInt(), validate, eventCtrl.remove);

module.exports = router;