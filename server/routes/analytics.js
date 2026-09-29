const router = require('express').Router();
const { authRequired } = require('../middleware/auth');
const a = require('../controllers/analyticsController');

router.get('/overview', authRequired, a.overview);
router.get('/revenue', authRequired, a.revenue);
router.get('/products', authRequired, a.products);
router.get('/categories', authRequired, a.categories);
router.get('/customers', authRequired, a.customers);
router.get('/order-status', authRequired, a.orderStatus);
router.get('/tiffins', authRequired, a.tiffins);
router.get('/tiffin-preparation', authRequired, a.tiffinPreparation);
router.put('/tiffin-preparation/menu', authRequired, a.saveTiffinMenuSelection);
router.get('/custom', authRequired, a.customOrders);

module.exports = router;
