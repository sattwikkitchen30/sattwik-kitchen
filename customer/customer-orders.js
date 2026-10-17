// ─── Constants & helpers ─────────────────────────────────────────────────────
const token = localStorage.getItem('sattwikCustomerToken');
const ordersList = document.getElementById('ordersList');
const ordersMessage = document.getElementById('ordersMessage');

// Delivery subscription status tracker steps
const deliveryStatusSteps = ['PENDING', 'ACCEPTED', 'OUT_FOR_DELIVERY', 'DELIVERED'];

if (!token) window.location.href = `/customer/login.html?return=${encodeURIComponent('/customer/orders.html')}`;

// Current active tab (component-level tab state)
let activeTab = 'ongoing';
// All loaded fulfillment components (flat list derived from API orders)
let allComponents = [];

// ─── Formatting utilities ─────────────────────────────────────────────────────
function money(value) { return `$${Number(value || 0).toFixed(2)}`; }

function dateLabel(value) {
  return new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Vancouver' });
}

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

function pickupStatusLabel(status) {
  return ({ PENDING: 'Pending', ACCEPTED: 'Accepted', DELIVERED: 'Delivered', CANCELLED: 'Cancelled' })[status] || status;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Item classification ──────────────────────────────────────────────────────
/**
 * Returns the item-level pickup status for an order component.
 * Uses item.deliveryStatus when available, falling back to order.status for
 * pickup-only orders. Does NOT expose delivery status to pickup cards.
 */
function getPickupItemStatus(order, pickupItems) {
  // Prefer item-level deliveryStatus fields for pick-up items
  const statuses = pickupItems.map((item) => String(item.deliveryStatus || 'PENDING').toUpperCase());
  if (statuses.includes('DELIVERED')) return 'DELIVERED';
  if (statuses.includes('CANCELLED')) return 'CANCELLED';
  if (statuses.includes('ACCEPTED')) return 'ACCEPTED';
  // For pickup-only orders that use the order-level status
  const deliveryItems = (order.items || []).filter((i) => i.fulfillment === 'delivery');
  if (!deliveryItems.length) {
    const s = String(order.status || 'PENDING').toUpperCase();
    if (s === 'DELIVERED' || s === 'delivered') return 'DELIVERED';
    if (s === 'CANCELLED' || s === 'cancelled') return 'CANCELLED';
    if (['ACCEPTED', 'confirmed', 'preparing', 'ready'].includes(s)) return 'ACCEPTED';
  }
  return 'PENDING';
}

/**
 * Determine the current *overall* delivery status for the subscription component.
 * The order.status field is managed server-side and reflects the subscription-level status.
 */
function getDeliveryStatus(order) {
  return String(order.status || 'PENDING').toUpperCase();
}

/**
 * True if the *entire* tiffin subscription has completed all required service days.
 * Only backend-confirmed DELIVERED status (after all service dates exhausted) counts.
 * A single daily-delivery "DELIVERED" does NOT count — the server resets to ACCEPTED
 * for the next day's delivery, so by the time status truly stays DELIVERED, the
 * subscription window has ended.
 */
function isSubscriptionFullyComplete(order) {
  if (getDeliveryStatus(order) !== 'DELIVERED') return false;
  // Extra guard: if there are future service dates, don't treat as complete.
  const endDate = order.subscriptionEndDate;
  if (!endDate) return true;
  const today = new Date().toISOString().slice(0, 10);
  return String(endDate).slice(0, 10) <= today;
}

// ─── Tiffin name helper ───────────────────────────────────────────────────────
function tiffinPlanName(item, order, deliveryItems) {
  const identifiers = [
    item.packageType, item.planType, item.planName, item.planId, item.productName
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
  const size = savedSize ? `${savedSize[0].toUpperCase()}${savedSize.slice(1).toLowerCase()}` : '';
  return packageType && size ? `${packageType} — ${size}` : size || item.productName || 'Tiffin Plan';
}

// ─── Component amount calculation ─────────────────────────────────────────────
/**
 * Compute the correct subtotal for a fulfillment component from item-level
 * subtotals. For pickup: sum of pickup item subtotals. For delivery: sum of
 * delivery item subtotals.
 *
 * Falls back gracefully: if items have no subtotal (legacy), falls back to
 * totalAmount only when the order is single-component (not mixed).
 */
function componentAmount(order, fulfillmentType) {
  const items = (order.items || []).filter((i) => i.fulfillment === fulfillmentType);
  if (items.length) {
    const sum = items.reduce((acc, i) => acc + (Number(i.subtotal) || 0), 0);
    if (sum > 0) return Math.round(sum * 100) / 100;
  }
  // Fallback: only use order.totalAmount when order is single-component
  const pickupCount = (order.items || []).filter((i) => i.fulfillment === 'pickup').length;
  const deliveryCount = (order.items || []).filter((i) => i.fulfillment === 'delivery').length;
  const isMixed = pickupCount > 0 && deliveryCount > 0;
  return isMixed ? 0 : (Number(order.totalAmount) || 0);
}

// ─── Tab classification ───────────────────────────────────────────────────────
/**
 * Classify a fulfillment component into 'ongoing', 'delivered', or 'cancelled'.
 */
function classifyComponent(component) {
  const status = String(component?.status || '').toUpperCase();
  if (status === 'CANCELLED') return 'cancelled';
  if (status === 'DELIVERED') return 'delivered';
  return 'ongoing';
}

// ─── Explode order → fulfillment components ───────────────────────────────────
/**
 * Break one DB order into 1–2 display components (pickup and/or delivery).
 * Each component carries enough information to render independently.
 */
function extractComponents(order) {
  const items = order.items || [];
  const pickupItems = items.filter((i) => i.fulfillment === 'pickup'
    || (!i.fulfillment && order.fulfillment === 'pickup'));
  const deliveryItems = items.filter((i) => i.fulfillment === 'delivery');

  const components = [];

  if (pickupItems.length > 0) {
    const status = getPickupItemStatus(order, pickupItems);
    const isCancelled = status === 'CANCELLED'
      || (order.fulfillment !== 'mixed' && String(order.status || '').toUpperCase() === 'CANCELLED');
    components.push({
      type: 'pickup',
      order,
      items: pickupItems,
      status: isCancelled ? 'CANCELLED' : status,
      amount: componentAmount(order, 'pickup')
    });
  }

  if (deliveryItems.length > 0) {
    const rawStatus = getDeliveryStatus(order);
    components.push({
      type: 'delivery',
      order,
      items: deliveryItems,
      status: rawStatus,
      amount: componentAmount(order, 'delivery'),
      // pass through for isSubscriptionFullyComplete
      subscriptionEndDate: order.subscriptionEndDate
    });
  }

  // Edge case: order with no classifiable items (e.g. custom/catering)
  if (!components.length) {
    const rawStatus = String(order.status || 'PENDING').toUpperCase();
    components.push({
      type: 'pickup',
      order,
      items: [],
      status: rawStatus,
      amount: Number(order.totalAmount) || 0
    });
  }

  return components;
}

// ─── Status tracker (preserved exactly) ──────────────────────────────────────
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

// ─── Component card renderer ──────────────────────────────────────────────────
function renderComponent(component) {
  const { type, order, items, status, amount } = component;
  const isPickup = type === 'pickup';
  const isMixed = order.fulfillment === 'mixed';

  // ── Item summary ──
  const deliveryItems = (order.items || []).filter((i) => i.fulfillment === 'delivery');
  const itemSummary = isPickup
    ? items.map((i) => `${escapeHtml(i.productName)} × ${Number(i.quantity) || 0}`).join(', ')
    : deliveryItems.map((i) => `${escapeHtml(tiffinPlanName(i, order, deliveryItems))} × ${Number(i.quantity) || 0}`).join(', ');

  // ── Date label ──
  const dateInfo = isPickup
    ? (order.pickupDate ? `Pickup: <strong>${escapeHtml(pickupDateLabel(order.pickupDate))}</strong>` : '')
    : (() => {
        const start = order.subscriptionStartDate;
        const end = order.subscriptionEndDate;
        if (start && end) return `<strong>${escapeHtml(orderDateLabel(start))}</strong> – <strong>${escapeHtml(orderDateLabel(end))}</strong>`;
        if (start) return `Starts: <strong>${escapeHtml(orderDateLabel(start))}</strong>`;
        return '';
      })();

  // ── Status badge class ──
  const statusClass = status === 'DELIVERED' ? 'status-delivered'
    : status === 'CANCELLED' ? 'status-cancelled'
    : status === 'OUT_FOR_DELIVERY' ? 'status-out'
    : status === 'ACCEPTED' ? 'status-accepted'
    : 'status-pending';

  // ── Cancel eligibility ──
  // Only show cancel button on the pickup component (or single-component orders).
  // For delivery subscriptions, admin handles cancellation.
  const pickupStatus = isPickup ? status : null;
  const cancelDisabled = isPickup
    ? ['DELIVERED', 'CANCELLED'].includes(status) || Boolean(order.firstDeliveredAt || order.deliveredAt)
    : true; // delivery subscriptions: no customer-cancel button
  const showCancel = isPickup;

  // ── Timeline ──
  const timeline = isPickup
    ? renderPickupTimeline(status)
    : renderTimeline(deliveryStatusSteps, status);

  // ── Overall order total (show on mixed orders so customer sees the full picture) ──
  const overallTotalNote = isMixed
    ? `<div class="component-overall-note">Overall order total: <strong>${escapeHtml(money(order.totalAmount))}</strong></div>`
    : '';

  // ── Delivery address (delivery components only) ──
  const deliveryAddressHtml = !isPickup && order.deliveryAddress
    ? `<div class="order-address"><strong>Delivery address</strong><br>${escapeHtml(order.deliveryAddress)}</div>`
    : '';

  // ── Customer contact (only show on pickup; on delivery, admin manages contact) ──
  const confirmedCustomer = order.customer || {};
  const customerHasDetails = confirmedCustomer.firstName || confirmedCustomer.lastName
    || confirmedCustomer.phone || confirmedCustomer.email;
  const customerDetailsHtml = isPickup && customerHasDetails
    ? `<div class="order-address"><strong>Order contact</strong><br>${escapeHtml([confirmedCustomer.firstName, confirmedCustomer.lastName].filter(Boolean).join(' '))}<br>${escapeHtml(confirmedCustomer.phone || '')}<br>${escapeHtml(confirmedCustomer.email || '')}${confirmedCustomer.address || confirmedCustomer.area ? `<br>${escapeHtml(confirmedCustomer.address || confirmedCustomer.area)}` : ''}</div>`
    : '';

  // ── Card ID (for socket.io live updates) ──
  const cardId = `${order._id}-${type}`;

  // ── Collapsed header summary ──
  const fulfillmentBadge = isPickup ? 'Pickup' : 'Delivery';
  const fulfillmentBadgeClass = isPickup ? 'badge-pickup' : 'badge-delivery';
  const compactDate = isPickup
    ? (order.pickupDate ? escapeHtml(pickupDateLabel(order.pickupDate)) : '')
    : (() => {
        const start = order.subscriptionStartDate;
        const end = order.subscriptionEndDate;
        if (start && end) return `${escapeHtml(orderDateLabel(start))} – ${escapeHtml(orderDateLabel(end))}`;
        return start ? escapeHtml(orderDateLabel(start)) : '';
      })();

  return `
    <article class="order-card" data-order-id="${order._id}" data-component-id="${escapeHtml(cardId)}" data-type="${escapeHtml(type)}">
      <!-- Collapsed header -->
      <div class="order-card-header">
        <div class="order-card-meta">
          <div class="order-card-top-row">
            <span class="order-id-label">Order #${escapeHtml(order.orderId)}</span>
            <span class="fulfillment-badge ${escapeHtml(fulfillmentBadgeClass)}">${escapeHtml(fulfillmentBadge)}</span>
          </div>
          <div class="order-card-summary">
            <span class="card-item-summary">${itemSummary}</span>
            ${compactDate ? `<span class="card-date-summary">${compactDate}</span>` : ''}
          </div>
        </div>
        <div class="order-card-aside">
          <span class="order-component-amount">${escapeHtml(money(amount))}</span>
          <span class="order-status-badge ${escapeHtml(statusClass)}">${escapeHtml(isPickup ? pickupStatusLabel(status) : statusLabel(status))}</span>
          <button type="button" class="details-toggle" aria-expanded="false" data-target="details-${escapeHtml(cardId)}">View details</button>
        </div>
      </div>

      <!-- Expanded details (hidden by default) -->
      <div class="order-details-panel hidden" id="details-${escapeHtml(cardId)}">
        <div class="order-details-grid">
          <div class="order-details-col">
            <dl class="order-detail-list">
              <div><dt>Order ID</dt><dd>${escapeHtml(order.orderId)}</dd></div>
              <div><dt>Order placed</dt><dd>${escapeHtml(dateLabel(order.placedAt || order.createdAt))}</dd></div>
              <div><dt>Fulfillment</dt><dd>${escapeHtml(fulfillmentBadge)}</dd></div>
              ${isPickup && order.pickupDate ? `<div><dt>Pickup date</dt><dd>${escapeHtml(pickupDateLabel(order.pickupDate))}</dd></div>` : ''}
              ${!isPickup && order.subscriptionStartDate ? `<div><dt>Start date</dt><dd>${escapeHtml(orderDateLabel(order.subscriptionStartDate))}</dd></div>` : ''}
              ${!isPickup && order.subscriptionEndDate ? `<div><dt>End date</dt><dd>${escapeHtml(orderDateLabel(order.subscriptionEndDate))}</dd></div>` : ''}
              <div><dt>Status</dt><dd>${escapeHtml(isPickup ? pickupStatusLabel(status) : statusLabel(status))}</dd></div>
              <div><dt>Component total</dt><dd>${escapeHtml(money(amount))}</dd></div>
            </dl>
          </div>
          <div class="order-details-col">
            <p class="order-details-items-heading">Items</p>
            <ul class="order-details-items">
              ${items.map((i) => `<li><span>${escapeHtml(isPickup ? i.productName : tiffinPlanName(i, order, deliveryItems))}</span><span>× ${Number(i.quantity) || 0}</span><span>${escapeHtml(money((Number(i.subtotal) || 0)))}</span></li>`).join('')}
            </ul>
            ${overallTotalNote}
          </div>
        </div>
        ${timeline}
        ${customerDetailsHtml}
        ${deliveryAddressHtml}
        ${isPickup && !cancelDisabled ? `<div class="order-actions"><button type="button" class="cancel-order-btn" data-cancel-order="${escapeHtml(order._id)}" data-cancel-type="${escapeHtml(type)}">Cancel Order</button></div>` : ''}
        ${isPickup && cancelDisabled && showCancel && ['DELIVERED', 'CANCELLED'].includes(status) ? `<div class="order-actions"><button type="button" class="cancel-order-btn" disabled aria-disabled="true">Cancel Order</button></div>` : ''}
        <button type="button" class="details-toggle details-hide" aria-expanded="true" data-target="details-${escapeHtml(cardId)}">Hide details</button>
      </div>
    </article>
  `;
}

// ─── Tab filtering and rendering ──────────────────────────────────────────────
function updateTabCounts(components) {
  const counts = { ongoing: 0, delivered: 0, cancelled: 0 };
  for (const c of components) counts[classifyComponent(c)]++;
  ['ongoing', 'delivered', 'cancelled'].forEach((tab) => {
    const el = document.getElementById(`tabCount${tab.charAt(0).toUpperCase() + tab.slice(1)}`);
    if (el) el.textContent = counts[tab] > 0 ? counts[tab] : '';
  });
}

function renderTab(tab, components) {
  const filtered = components.filter((c) => classifyComponent(c) === tab);
  if (!filtered.length) {
    const label = tab === 'ongoing' ? 'ongoing orders' : tab === 'delivered' ? 'delivered orders' : 'cancelled orders';
    ordersList.innerHTML = `<div class="empty-orders">You have no ${label} right now.</div>`;
    return;
  }
  ordersList.innerHTML = filtered.map(renderComponent).join('');
}

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.orders-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  renderTab(tab, allComponents);
}

// ─── Main render ──────────────────────────────────────────────────────────────
function renderOrders(orders) {
  // Explode each DB order into fulfillment components
  allComponents = orders.flatMap(extractComponents);
  updateTabCounts(allComponents);
  renderTab(activeTab, allComponents);
}

// ─── Data loading ─────────────────────────────────────────────────────────────
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

// ─── Tab click handler ────────────────────────────────────────────────────────
document.querySelector('.orders-tabs')?.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-tab]');
  if (tab) switchTab(tab.dataset.tab);
});

// ─── Details toggle ───────────────────────────────────────────────────────────
ordersList.addEventListener('click', (event) => {
  // Details toggle
  const toggleBtn = event.target.closest('.details-toggle');
  if (toggleBtn) {
    const panelId = toggleBtn.dataset.target;
    const panel = document.getElementById(panelId);
    if (!panel) return;
    const isHidden = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !isHidden);
    // Update all toggles pointing to this panel
    document.querySelectorAll(`[data-target="${CSS.escape(panelId)}"]`).forEach((btn) => {
      btn.setAttribute('aria-expanded', String(isHidden));
      if (btn.classList.contains('details-hide')) {
        btn.textContent = isHidden ? 'Hide details' : 'View details';
      } else {
        btn.textContent = isHidden ? 'Hide details' : 'View details';
      }
    });
    return;
  }

  // Cancel order
  const cancelBtn = event.target.closest('[data-cancel-order]');
  if (!cancelBtn || cancelBtn.disabled) return;
  handleCancelOrder(cancelBtn);
});

async function handleCancelOrder(button) {
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
}

// ─── Logout ───────────────────────────────────────────────────────────────────
document.getElementById('logoutButton')?.addEventListener('click', async () => {
  try { await fetch('/api/customer-auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }); } catch (_e) { /* local logout still completes */ }
  localStorage.removeItem('sattwikCustomerToken');
  localStorage.removeItem('sattwikCustomer');
  window.location.href = '/';
});

// ─── Real-time updates ────────────────────────────────────────────────────────
const socket = window.io ? io({ auth: { token } }) : null;
socket?.on('order:updated', (updatedOrder) => {
  // Find and replace any component cards for this order, then re-render tab
  const existing = allComponents.filter((c) => c.order._id === updatedOrder._id);
  if (existing.length) {
    // Replace in allComponents
    allComponents = allComponents.filter((c) => c.order._id !== updatedOrder._id);
    allComponents.push(...extractComponents(updatedOrder));
    updateTabCounts(allComponents);
    renderTab(activeTab, allComponents);
  } else {
    loadOrders();
  }
});

// ─── Bootstrap ───────────────────────────────────────────────────────────────
loadOrders();
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadOrders();
});
