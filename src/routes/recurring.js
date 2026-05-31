const express = require('express');
const router = express.Router();
const rec = require('../controllers/recurringController');
const auth = require('../middleware/auth');
const { body, param, validationResult } = require('express-validator');

const validate = (req, res, next) => {
	const errors = validationResult(req);
	if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
	next();
};

router.get('/', auth.authenticateJWT, rec.list);
router.post('/', auth.authenticateJWT, body('cart_snapshot').isArray({ min: 1 }), body('interval').isIn(['weekly','monthly','bimonthly','quarterly','halfyearly']), body('next_run').isISO8601(), validate, rec.create);
router.delete('/:id', auth.authenticateJWT, param('id').isInt(), validate, rec.remove);

module.exports = router;
