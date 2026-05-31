const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const offerCtrl = require('../controllers/offerController');
const auth = require('../middleware/auth');

const validate = (req, res, next) => {
	const errors = validationResult(req);
	if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
	next();
};

router.get('/', offerCtrl.list);
router.post('/',
	auth.authenticateJWT,
	auth.authorizeRole(['admin']),
	body('product_id').isInt({ gt: 0 }),
	body('type').isIn(['bogo', 'percent', 'hot_hour']),
	body('buy').optional().isInt({ min: 0 }),
	body('free').optional().isInt({ min: 0 }),
	body('percent').optional().isFloat({ min: 0, max: 100 }),
	body('hour').optional().isInt({ min: 0, max: 23 }),
	validate,
	offerCtrl.create);

router.delete('/:id', auth.authenticateJWT, auth.authorizeRole(['admin']), param('id').isInt(), validate, offerCtrl.remove);

module.exports = router;
