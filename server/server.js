require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const connectDB = require('./config/db');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { wrapRouter } = require('./utils/asyncRoutes');
const ensurePrimaryAdmin = require('./utils/ensurePrimaryAdmin');
const { authRequired } = require('./middleware/auth');

const allowed = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()) : true;
const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: allowed } });
app.set('io', io);

connectDB();

app.use(cors({ origin: allowed }));
app.use(express.json({ limit: '1mb' }));

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));
app.get('/admin', (req, res) => res.redirect('/admin/login.html'));
app.get('/admin/signup', (req, res) => res.redirect('/admin/login.html'));
app.use('/customer', express.static(path.join(__dirname, '..', 'customer')));
app.get('/customer/login', (req, res) => res.sendFile(path.join(__dirname, '..', 'customer', 'login.html')));
app.get('/customer/orders', (req, res) => res.sendFile(path.join(__dirname, '..', 'customer', 'orders.html')));
app.get('/delivery/signup', (req, res) => res.redirect('/delivery/login.html'));
app.get('/delivery/signup.html', (req, res) => res.redirect('/delivery/login.html'));
app.use('/delivery', express.static(path.join(__dirname, '..', 'delivery')));
app.get('/delivery/login', (req, res) => res.sendFile(path.join(__dirname, '..', 'delivery', 'login.html')));
app.get('/delivery/dashboard', (req, res) => res.sendFile(path.join(__dirname, '..', 'delivery', 'dashboard.html')));

app.use('/api/auth', wrapRouter(require('./routes/auth')));
app.use('/api/customer-auth', wrapRouter(require('./routes/customerAuth')));
app.use('/api/customer-orders', wrapRouter(require('./routes/customerOrders')));
app.use('/api/delivery-auth', wrapRouter(require('./routes/deliveryAuth')));
app.use('/api/delivery-orders', wrapRouter(require('./routes/deliveryOrders')));
app.use('/api/delivery-members', wrapRouter(require('./routes/deliveryMembers')));
app.use('/api/products', wrapRouter(require('./routes/products')));
app.use('/api/orders', wrapRouter(require('./routes/orders')));
app.use('/api/customers', wrapRouter(require('./routes/customers')));
app.use('/api/analytics', wrapRouter(require('./routes/analytics')));
app.use('/api/export', wrapRouter(require('./routes/export')));

app.post('/api/clear-demo', authRequired, async (req, res) => {
  try {
    const Order = require('./models/Order');
    const Customer = require('./models/Customer');
    const [orders, customers] = await Promise.all([
      Order.deleteMany({ isDemo: true }),
      Customer.deleteMany({ isDemo: true })
    ]);
    res.json({
      message: `Removed ${orders.deletedCount} demo orders and ${customers.deletedCount} demo customers`,
      removedOrders: orders.deletedCount,
      removedCustomers: customers.deletedCount
    });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Could not clear demo data' });
  }
});

app.use('/api', notFound);
app.use('/api', errorHandler);

const PORT = process.env.PORT || 5000;

io.on('connection', (socket) => {
  try {
    const token = socket.handshake.auth?.token;
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret_change_me');
    if (payload.type === 'customer') socket.join(`customer:${payload.id}`);
    if (payload.type === 'delivery') socket.join(`delivery:${payload.id}`);
    if (payload.type === 'admin') socket.join('admin');
  } catch (error) {
    socket.disconnect(true);
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('[sattwik] unhandled rejection:', reason instanceof Error ? reason.message : reason);
});

httpServer.listen(PORT, async () => {
  console.log(`Sattwik Kitchen server running on http://localhost:${PORT}`);
  await ensurePrimaryAdmin();
});