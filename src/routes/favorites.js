const express = require('express');
const router = express.Router();
const fav = require('../controllers/favoritesController');
const auth = require('../middleware/auth');
const { body, param, validationResult } = require('express-validator');

const validate = (req, res, next) => {
	const errors = validationResult(req);
	if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
	next();
};

router.get('/', auth.authenticateJWT, fav.list);
router.post('/', auth.authenticateJWT, body('product_id').isInt({ gt: 0 }), validate, fav.add);
router.delete('/:product_id', auth.authenticateJWT, param('product_id').isInt(), validate, fav.remove);

module.exports = router;
