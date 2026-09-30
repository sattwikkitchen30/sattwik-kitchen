const token = localStorage.getItem('sattwikCustomerToken');
const ordersList = document.getElementById('ordersList');
const ordersMessage = document.getElementById('ordersMessage');
const deliveryStatusSteps = ['PENDING', 'ACCEPTED', 'OUT_FOR_DELIVERY', 'DELIVERED'];

if (!token) window.location.href = `/customer/login.html?return=${encodeURIComponent('/customer/orders.html')}`;

function money(value) { return `$${Number(value || 0).toFixed(2)}`; }
function dateLabel(value) { return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }
function statusLabel(status) { return String(status || '').replaceAll('_', ' '); }
function pickupStatusForOrder(order, pickupItems, deliveryItems) {
  const rawStatus = String(pickupItems[0]?.deliveryStatus || (deliveryItems.length ? 'PENDING' : order.status || 'PENDING')).toUpperCase();
  if (rawStatus === 'CANCELLED') return 'CANCELLED';
  if (['ACCEPTED', 'CONFIRMED', 'PREPARING', 'READY', 'DELIVERED', 'OUT_FOR_DELIVERY'].includes(rawStatus)) return 'ACCEPTED';
  return 'PENDING';
}
function renderTimeline(steps, currentStatus) {
  const currentIndex = steps.indexOf(currentStatus);
  const finalIndex = currentIndex >= 0 ? currentIndex : 0;
  return `<div class="timeline">${steps.map((step, index) => `<div class="timeline-step ${index < finalIndex ? 'complete' : ''} ${index === finalIndex ? 'current' : ''}"><div class="dot">${index < finalIndex ? '✓' : index === finalIndex ? '●' : '○'}</div><span>${statusLabel(step)}</span></div>`).join('')}</div>`;
}
function renderPickupTimeline(status) {
  const steps = status === 'CANCELLED' ? ['PENDING', 'CANCELLED'] : status === 'ACCEPTED' ? ['PENDING', 'ACCEPTED'] : ['PENDING'];
  return `<div class="timeline">${steps.map((step, index) => {
    const complete = status === 'ACCEPTED' || (status === 'CANCELLED' && index === 0);
    const current = !complete && index === steps.length - 1;
    return `<div class="timeline-step ${complete ? 'complete' : ''} ${current ? 'current' : ''}"><div class="dot">${complete ? '✓' : current ? '●' : '○'}</div><span>${statusLabel(step)}</span></div>`;
  }).join('')}</div>`;
}
function renderOrder(order) {
  const items = order.items || [];
  const pickupItems = items.filter((item) => item.fulfillment === 'pickup');
  const deliveryItems = items.filter((item) => item.fulfillment === 'delivery');
  const pickupStatus = pickupStatusForOrder(order, pickupItems, deliveryItems);
  const isTiffinOrder = order.type === 'tiffin' && deliveryItems.length > 0;
  const deliveryTracking = isTiffinOrder ? '' : (deliveryItems.length || !pickupItems.length ? renderTimeline(deliveryStatusSteps, order.status) : '');
  const pickupTracking = pickupItems.length
    ? `<section class="pickup-tracking"><h3>Pickup</h3>${renderPickupTimeline(pickupStatus)}</section>`
    : '';
  const deliveryDate = order.serviceDate || order.placedAt || order.createdAt;
  const subscriptionStart = order.subscriptionStartDate || order.startDate || null;
  const subscriptionEnd = order.subscriptionEndDate || order.endDate || null;
  const subscriptionText = subscriptionStart && subscriptionEnd
    ? `<div class="order-meta"><strong>Order ID:</strong> ${order.orderId}<br><strong>Plan:</strong> ${items.map((item) => item.productName).join(', ') || 'Tiffin Plan'}<br><strong>Type:</strong> ${order.type}<br><strong>Start Date:</strong> ${new Date(subscriptionStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}<br><strong>End Date:</strong> ${new Date(subscriptionEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}<br><strong>Amount:</strong> ${money(order.totalAmount)}</div>`
    : `<div class="order-meta"><strong>Order ID:</strong> ${order.orderId}<br><strong>Amount:</strong> ${money(order.totalAmount)}</div>`;
  return `
    <article class="order-card" data-order-id="${order._id}">
      <div class="order-card-header">
        <div><h2>${order.orderId}</h2><p>${isTiffinOrder ? 'Subscription order' : `Placed ${dateLabel(order.placedAt || order.createdAt)}`}</p></div>
        <strong class="order-total">${money(order.totalAmount)}</strong>
      </div>
      ${subscriptionText}
      ${deliveryTracking}
      ${pickupTracking}
      <div class="order-items">${items.map((item) => `<div class="order-item"><span>${item.productName} × ${item.quantity}</span><strong>${money(item.subtotal)}</strong></div>`).join('')}</div>
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
