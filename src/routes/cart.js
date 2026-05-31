const express = require('express');

const router = express.Router();
const cart = require('../controllers/cartController');
const auth = require('../middleware/auth');
const { body, param, validationResult } = require('express-validator');

const validate = (req, res, next) => {
	const errors = validationResult(req);
	if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
	next();
};

router.get('/', auth.authenticateJWT, cart.view);
router.post('/items', auth.authenticateJWT, body('product_id').isInt({ gt: 0 }), body('quantity').isInt({ gt: 0 }), validate, cart.addItem);
router.put('/items/:id', auth.authenticateJWT, param('id').isInt(), body('quantity').isInt({ min: 0 }), validate, cart.updateItem);
router.delete('/', auth.authenticateJWT, cart.clear);
router.post('/checkout', auth.authenticateJWT, cart.checkout);

module.exports = router;
