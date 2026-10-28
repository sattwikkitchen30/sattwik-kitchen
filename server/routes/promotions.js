const router = require('express').Router();
const c = require('../controllers/promotionController');
const { authRequired } = require('../middleware/auth');

// Public endpoints (customer page)
router.get('/', c.listActive);
router.get('/public', c.listActive);
router.get('/active', c.listActive);

// Admin-only endpoints
router.get('/all', authRequired, c.listAll);
router.get('/:id', authRequired, c.getOne);
router.post('/', authRequired, c.create);
router.put('/:id', authRequired, c.update);
router.patch('/:id/status', authRequired, c.updateStatus);
router.patch('/:id/toggle', authRequired, c.updateStatus);
router.delete('/:id', authRequired, c.remove);

module.exports = router;
