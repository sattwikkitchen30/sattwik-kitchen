const router = require('express').Router();
const c = require('../controllers/orderController');
const { authRequired } = require('../middleware/auth');
const { customerAuthRequired } = require('../middleware/customerAuth');

router.post('/', customerAuthRequired, c.createOrder);
router.post('/manual', authRequired, c.createManualOrder);
router.get('/', authRequired, c.listOrders);
router.get('/:id', authRequired, c.getOrder);
router.get('/:id/payments', authRequired, c.getPayments);
router.post('/:id/payments', authRequired, c.addPayment);
router.put('/:id/amount', authRequired, c.updateAmount);
router.put('/:id/tiffin-items', authRequired, c.updateTiffinItems);
router.put('/:id/status', authRequired, c.updateStatus);
router.put('/:id/pickup-date', authRequired, c.updatePickupDate);
router.put('/:id/tiffin-end-date', authRequired, c.updateTiffinEndDate);
router.put('/:id/assign', authRequired, c.assignDeliveryMember);
router.delete('/:id', authRequired, c.deleteOrder);

module.exports = router;
