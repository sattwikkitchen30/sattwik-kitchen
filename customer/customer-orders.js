const token = localStorage.getItem('sattwikCustomerToken');
const ordersList = document.getElementById('ordersList');
const ordersMessage = document.getElementById('ordersMessage');
const deliveryStatusSteps = ['PENDING', 'ACCEPTED', 'OUT_FOR_DELIVERY', 'DELIVERED'];

if (!token) window.location.href = `/customer/login.html?return=${encodeURIComponent('/customer/orders.html')}`;

function money(value) { return `$${Number(value || 0).toFixed(2)}`; }
function dateLabel(value) { return new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Vancouver' }); }
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
    DELIVERED: 'Delivered',
    CANCELLED: 'Cancelled'
  })[status] || String(status || '').replaceAll('_', ' ');
}
function pickupStatusForOrder(order, pickupItems, deliveryItems) {
  const pickupStatuses = pickupItems.map((item) => String(item.deliveryStatus || 'PENDING').toUpperCase());
  const rawStatus = pickupStatuses.includes('DELIVERED')
    ? 'DELIVERED'
    : pickupStatuses.includes('CANCELLED')
      ? 'CANCELLED'
      : pickupStatuses[0] || (deliveryItems.length ? 'PENDING' : String(order.status || 'PENDING').toUpperCase());
  if (rawStatus === 'CANCELLED') return 'CANCELLED';
  if (rawStatus === 'DELIVERED') return 'DELIVERED';
  if (['ACCEPTED', 'CONFIRMED', 'PREPARING', 'READY'].includes(rawStatus)) return 'ACCEPTED';
  return 'PENDING';
}
function pickupStatusLabel(status) {
  return ({ PENDING: 'Pending', ACCEPTED: 'Accepted', DELIVERED: 'Delivered', CANCELLED: 'Cancelled' })[status] || status;
}
function tiffinPlanName(item, order, deliveryItems) {
  const identifiers = [
    item.packageType,
    item.planType,
    item.planName,
    item.planId,
    item.productName
  ].filter(Boolean).join(' ').toLowerCase();
  const packageType = /curry[\s_-]*only/.test(identifiers)
    ? 'Curry-Only'
    : /\bfull(?:[\s_-]*meal)?\b/.test(identifiers)
      ? 'Full Meal'
      : deliveryItems.length === 1
        ? ({ full: 'Full Meal', 'curry-only': 'Curry-Only' })[String(order.tiffinPlan?.packageType || '').toLowerCase()]
        : '';
  const savedSize = String(item.size || item.planSize || item.productName || '').match(/\b(single|couple|family)\b/i)?.[1]
    || (deliveryItems.length === 1 ? order.tiffinPlan?.size : '');
  const size = savedSize
    ? `${savedSize[0].toUpperCase()}${savedSize.slice(1).toLowerCase()}`
    : '';
  return packageType && size
    ? `${packageType} - ${size}`
    : size || 'Tiffin Plan';
}
function orderItemSummary(order, pickupItems, deliveryItems) {
  if (order.type === 'tiffin' && deliveryItems.length) {
    return deliveryItems
      .map((item) => `${tiffinPlanName(item, order, deliveryItems)} × ${Number(item.quantity) || 0}`)
      .join(', ');
  }
  return pickupItems
    .map((item) => `${item.productName} × ${Number(item.quantity) || 0}`)
    .join(', ');
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
  const timelineSteps = currentStatus === 'CANCELLED' ? [...steps, 'CANCELLED'] : steps;
  const currentIndex = timelineSteps.indexOf(currentStatus);
  const finalIndex = currentIndex >= 0 ? currentIndex : 0;
  return `<div class="timeline">${timelineSteps.map((step, index) => {
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
  const itemSummary = escapeHtml(orderItemSummary(order, pickupItems, deliveryItems));
  const fulfillmentLabel = pickupItems.length && deliveryItems.length
    ? 'Pickup and delivery'
    : deliveryItems.length
      ? 'Delivery'
      : 'Pickup';
  const currentStatus = isPickupOnlyOrder ? pickupStatus : String(order.status || 'PENDING').toUpperCase();
  const cancelDisabled = ['DELIVERED', 'CANCELLED'].includes(currentStatus) || Boolean(order.firstDeliveredAt || order.deliveredAt);
  const deliveryTracking = deliveryItems.length || !pickupItems.length ? renderTimeline(deliveryStatusSteps, order.status) : '';
  const pickupTracking = pickupItems.length
    ? `<section class="pickup-tracking">
        <h3>Pickup details</h3>
        <dl class="pickup-order-details">
          <div><dt>Pickup Date</dt><dd>${pickupDateLabel(order.pickupDate)}</dd></div>
          <div><dt>Order Date</dt><dd>${dateLabel(order.placedAt || order.createdAt)}</dd></div>
          <div><dt>Fulfillment</dt><dd>Pickup</dd></div>
          <div><dt>Items</dt><dd>${itemSummary}</dd></div>
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
      ? `<div class="order-meta"><strong>Order ID:</strong> ${escapeHtml(order.orderId)}<br><strong>Order Date:</strong> ${dateLabel(order.placedAt || order.createdAt)}<br><strong>Type:</strong> ${escapeHtml(order.type || 'tiffin')}<br><strong>Fulfillment:</strong> ${fulfillmentLabel}<br><strong>Items:</strong> ${itemSummary}<br><strong>Start Date:</strong> ${orderDateLabel(subscriptionStart)}<br><strong>End Date:</strong> ${orderDateLabel(subscriptionEnd)}<br><strong>Amount:</strong> ${money(order.totalAmount)}</div>`
      : `<div class="order-meta"><strong>Order ID:</strong> ${escapeHtml(order.orderId)}<br><strong>Order Date:</strong> ${dateLabel(order.placedAt || order.createdAt)}<br><strong>Type:</strong> ${escapeHtml(order.type || 'product')}<br><strong>Fulfillment:</strong> ${fulfillmentLabel}<br><strong>Items:</strong> ${itemSummary}<br><strong>Amount:</strong> ${money(order.totalAmount)}</div>`;
  const confirmedCustomer = order.customer || {};
  const customerDetails = confirmedCustomer.firstName || confirmedCustomer.lastName || confirmedCustomer.phone || confirmedCustomer.email
    ? `<div class="order-address"><strong>Order contact</strong><br>${escapeHtml([confirmedCustomer.firstName, confirmedCustomer.lastName].filter(Boolean).join(' '))}<br>${escapeHtml(confirmedCustomer.phone || '')}<br>${escapeHtml(confirmedCustomer.email || '')}${confirmedCustomer.address || confirmedCustomer.area ? `<br>${escapeHtml(confirmedCustomer.address || confirmedCustomer.area)}` : ''}</div>`
    : '';
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
      ${customerDetails}
      ${(deliveryItems.length || !pickupItems.length) && order.deliveryAddress ? `<div class="order-address"><strong>Delivery address</strong><br>${escapeHtml(order.deliveryAddress)}</div>` : ''}
      <div class="order-actions"><button type="button" class="cancel-order-btn" data-cancel-order="${escapeHtml(order._id)}" ${cancelDisabled ? 'disabled aria-disabled="true"' : ''}>Cancel Order</button></div>
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

ordersList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-cancel-order]');
  if (!button || button.disabled) return;
  if (!window.confirm('Are you sure you want to cancel this order?')) return;
  button.disabled = true;
  ordersMessage.textContent = '';
  try {
    const response = await fetch(`/api/customer-orders/${encodeURIComponent(button.dataset.cancelOrder)}/cancel`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Could not cancel order.');
    await loadOrders();
  } catch (error) {
    ordersMessage.textContent = error.message || 'Could not cancel order.';
    await loadOrders();
  }
});

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
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadOrders();
});
