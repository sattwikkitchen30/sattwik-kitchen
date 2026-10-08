const token = localStorage.getItem('sattwikCustomerToken');
const ordersList = document.getElementById('ordersList');
const ordersMessage = document.getElementById('ordersMessage');
const deliveryStatusSteps = ['PENDING', 'ACCEPTED', 'OUT_FOR_DELIVERY', 'DELIVERED'];

if (!token) window.location.href = `/customer/login.html?return=${encodeURIComponent('/customer/orders.html')}`;

function money(value) { return `$${Number(value || 0).toFixed(2)}`; }
function dateLabel(value) { return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }
function pickupDateLabel(value) {
  if (!value) return '—';
  const dateKey = String(value).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
}
function orderDateLabel(value) {
  if (!value) return '—';
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.valueOf())
    ? '—'
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function statusLabel(status) {
  return ({
    PENDING: 'Pending',
    ACCEPTED: 'Accepted',
    OUT_FOR_DELIVERY: 'Out for Delivery',
    DELIVERED: 'Delivered'
  })[status] || String(status || '').replaceAll('_', ' ');
}
function pickupStatusForOrder(order, pickupItems, deliveryItems) {
  const rawStatus = String(pickupItems[0]?.deliveryStatus || (deliveryItems.length ? 'PENDING' : order.status || 'PENDING')).toUpperCase();
  if (rawStatus === 'CANCELLED') return 'CANCELLED';
  if (rawStatus === 'DELIVERED') return 'DELIVERED';
  if (['ACCEPTED', 'CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'].includes(rawStatus)) return 'ACCEPTED';
  return 'PENDING';
}
function pickupStatusLabel(status) {
  return ({ PENDING: 'Pending', ACCEPTED: 'Accepted', DELIVERED: 'Pickup Completed', CANCELLED: 'Cancelled' })[status] || status;
}
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function renderTimeline(steps, currentStatus) {
  const currentIndex = steps.indexOf(currentStatus);
  const finalIndex = currentIndex >= 0 ? currentIndex : 0;
  return `<div class="timeline">${steps.map((step, index) => {
    const complete = index < finalIndex || (step === 'DELIVERED' && currentStatus === 'DELIVERED');
    const current = index === finalIndex && !complete;
    return `<div class="timeline-step ${complete ? 'complete' : ''} ${current ? 'current' : ''}"><div class="dot">${complete ? '✓' : current ? '●' : '○'}</div><span>${statusLabel(step)}</span></div>`;
  }).join('')}</div>`;
}
function renderPickupTimeline(status) {
  const steps = status === 'CANCELLED' ? ['PENDING', 'CANCELLED'] : ['PENDING', 'ACCEPTED', 'DELIVERED'];
  const currentIndex = steps.indexOf(status);
  return `<div class="timeline">${steps.map((step, index) => {
    const complete = index < currentIndex || (step === 'DELIVERED' && status === 'DELIVERED');
    const current = index === currentIndex && !complete;
    return `<div class="timeline-step ${complete ? 'complete' : ''} ${current ? 'current' : ''}"><div class="dot">${complete ? '✓' : current ? '●' : '○'}</div><span>${pickupStatusLabel(step)}</span></div>`;
  }).join('')}</div>`;
}
function renderOrder(order) {
  const items = order.items || [];
  const pickupItems = items.filter((item) => item.fulfillment === 'pickup' || (!item.fulfillment && order.fulfillment === 'pickup'));
  const deliveryItems = items.filter((item) => item.fulfillment === 'delivery');
  const pickupStatus = pickupStatusForOrder(order, pickupItems, deliveryItems);
  const isTiffinOrder = order.type === 'tiffin' && deliveryItems.length > 0;
  const isPickupOnlyOrder = pickupItems.length > 0 && deliveryItems.length === 0;
  const deliveryTracking = deliveryItems.length || !pickupItems.length ? renderTimeline(deliveryStatusSteps, order.status) : '';
  const pickupTracking = pickupItems.length
    ? `<section class="pickup-tracking">
        <h3>Pickup details</h3>
        <dl class="pickup-order-details">
          <div><dt>Pickup Date</dt><dd>${pickupDateLabel(order.pickupDate)}</dd></div>
          <div><dt>Order Date</dt><dd>${dateLabel(order.placedAt || order.createdAt)}</dd></div>
          <div><dt>Status</dt><dd>${pickupStatusLabel(pickupStatus)}</dd></div>
          <div><dt>Amount</dt><dd>${money(order.totalAmount)}</dd></div>
        </dl>
        <p>Please pick up your order on this date.</p>
        ${renderPickupTimeline(pickupStatus)}
      </section>`
    : '';
  const deliveryDate = order.serviceDate || order.placedAt || order.createdAt;
  const subscriptionStart = order.subscriptionStartDate || order.startDate || null;
  const subscriptionEnd = order.subscriptionEndDate || order.endDate || null;
  const hasDeliveryDateRange = deliveryItems.length > 0 && Boolean(subscriptionStart && subscriptionEnd);
  const subscriptionText = isPickupOnlyOrder
    ? ''
    : hasDeliveryDateRange
      ? `<div class="order-meta"><strong>Order ID:</strong> ${order.orderId}<br><strong>Plan:</strong> ${items.map((item) => item.productName).join(', ') || 'Tiffin Plan'}<br><strong>Type:</strong> ${order.type}<br><strong>Start Date:</strong> ${orderDateLabel(subscriptionStart)}<br><strong>End Date:</strong> ${orderDateLabel(subscriptionEnd)}<br><strong>Amount:</strong> ${money(order.totalAmount)}</div>`
      : `<div class="order-meta"><strong>Order ID:</strong> ${order.orderId}<br><strong>Amount:</strong> ${money(order.totalAmount)}</div>`;
  const deliveryStartText = deliveryItems.length && !hasDeliveryDateRange
    ? `<div class="order-address"><strong>Start Date:</strong> ${orderDateLabel(subscriptionStart)}</div>`
    : '';
  return `
    <article class="order-card" data-order-id="${order._id}">
      <div class="order-card-header">
        <div><h2>${isPickupOnlyOrder ? 'Order #' : ''}${escapeHtml(order.orderId)}</h2>${!isPickupOnlyOrder ? `<p>${isTiffinOrder ? 'Subscription order' : `Placed ${dateLabel(order.placedAt || order.createdAt)}`}</p>` : ''}</div>
        ${!isPickupOnlyOrder ? `<strong class="order-total">${money(order.totalAmount)}</strong>` : ''}
      </div>
      ${subscriptionText}
      ${deliveryStartText}
      ${deliveryTracking}
      ${pickupTracking}
      ${isPickupOnlyOrder
        ? `<section class="pickup-products">
            <h3>Products</h3>
            <ul>${pickupItems.map((item) => `<li><span>${escapeHtml(item.productName)} × ${Number(item.quantity) || 0}</span></li>`).join('')}</ul>
          </section>`
        : `<div class="order-items">${items.map((item) => `<div class="order-item"><span>${item.productName} × ${item.quantity}</span><strong>${money(item.subtotal)}</strong></div>`).join('')}</div>`}
      ${(deliveryItems.length || !pickupItems.length) && order.deliveryAddress ? `<div class="order-address"><strong>Delivery address</strong><br>${order.deliveryAddress}</div>` : ''}
    </article>
  `;
}

function renderOrders(orders) {
  if (!orders.length) {
    ordersList.innerHTML = '<div class="empty-orders">You do not have any orders yet. Return to the menu to place one.</div>';
    return;
  }
  ordersList.innerHTML = orders.map(renderOrder).join('');
}

async function loadOrders() {
  try {
    const response = await fetch('/api/customer-orders', { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Could not load orders');
    renderOrders(data.orders || []);
  } catch (error) {
    ordersMessage.textContent = error.message;
  }
}

document.getElementById('logoutButton')?.addEventListener('click', async () => {
  try { await fetch('/api/customer-auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }); } catch (error) { /* local logout still completes */ }
  localStorage.removeItem('sattwikCustomerToken');
  localStorage.removeItem('sattwikCustomer');
  window.location.href = '/';
});

const socket = window.io ? io({ auth: { token } }) : null;
socket?.on('order:updated', (updatedOrder) => {
  const card = document.querySelector(`[data-order-id="${updatedOrder._id}"]`);
  if (card) card.outerHTML = renderOrder(updatedOrder);
  else loadOrders();
});

loadOrders();
function scheduleServiceDayRefresh() {
  const nextMidnight = new Date();
  nextMidnight.setHours(24, 0, 0, 50);
  window.setTimeout(() => {
    loadOrders();
    scheduleServiceDayRefresh();
  }, nextMidnight.getTime() - Date.now());
}
scheduleServiceDayRefresh();
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadOrders();
});
