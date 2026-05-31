const express = require('express');
const router = express.Router();

const controller = require('../controllers/productController');
const auth = require('../middleware/auth');

router.get('/', controller.list);
router.get('/:id', controller.getById);
router.post('/', auth.authenticateJWT, auth.authorizeRole(['admin']), controller.create);
router.put('/:id', auth.authenticateJWT, auth.authorizeRole(['admin']), controller.update);
router.delete('/:id', auth.authenticateJWT, auth.authorizeRole(['admin']), controller.remove);
// stock managers or admins can add stock
router.post('/:id/add-stock', auth.authenticateJWT, auth.authorizeRole(['admin','stock_manager']), controller.addStock);

module.exports = router;
