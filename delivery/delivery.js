const deliveryToken = localStorage.getItem('sattwikDeliveryToken');
const isDeliveryLogin = Boolean(document.getElementById('deliveryLoginForm'));
const deliveryMessage = document.getElementById('deliveryMessage');

async function deliveryApi(path, options = {}) {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deliveryToken}`, ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Request failed');
  return data;
}

if (!isDeliveryLogin && !deliveryToken) window.location.href = '/delivery/login.html';

document.getElementById('deliveryLoginForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  deliveryMessage.textContent = 'Signing in...';
  try {
    const response = await fetch('/api/delivery-auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: document.getElementById('deliveryEmail').value.trim(), password: document.getElementById('deliveryPassword').value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Login failed');
    localStorage.setItem('sattwikDeliveryToken', data.token);
    localStorage.setItem('sattwikDeliveryMember', JSON.stringify(data.member));
    window.location.href = '/delivery/dashboard.html';
  } catch (error) { deliveryMessage.textContent = error.message; }
});

function money(value) { return `$${Number(value || 0).toFixed(2)}`; }
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function deliveryStatusLabel(status) {
  return ({
    PENDING: 'Pending',
    ACCEPTED: 'Accepted',
    OUT_FOR_DELIVERY: 'Out for Delivery',
    DELIVERED: 'Delivered'
  })[status] || status;
}
function orderCard(order) {
  const next = { ACCEPTED: 'OUT_FOR_DELIVERY', OUT_FOR_DELIVERY: 'DELIVERED' }[order.status];
  const actionText = { OUT_FOR_DELIVERY: 'Start Delivery', DELIVERED: 'Mark as Delivered' }[next];
  const customer = order.customer || {};
  const activeLabel = ['ACCEPTED', 'OUT_FOR_DELIVERY'].includes(order.status) ? '<strong class="active-delivery-label">MY ACTIVE DELIVERY</strong>' : '';
  const acceptedTime = order.acceptedAt ? `<div><strong>Accepted</strong><br>${new Date(order.acceptedAt).toLocaleString('en-US', { timeZone: 'America/Vancouver' })}</div>` : '';
  const terminal = ['DELIVERED', 'CANCELLED'].includes(order.status) || Boolean(order.firstDeliveredAt || order.deliveredAt);
  return `<article class="delivery-order assigned-delivery" data-delivery-order="${escapeHtml(order._id)}">${activeLabel}<div class="delivery-order-head"><div><h2>${escapeHtml(order.orderId)}</h2><p>${escapeHtml(`${customer.firstName || ''} ${customer.lastName || ''}`.trim())} • ${escapeHtml(customer.phone || '')}<br>${escapeHtml(customer.email || '')}</p></div><strong class="delivery-order-total">${money(order.totalAmount)}</strong></div><div class="delivery-details"><div><strong>Address</strong><br>${escapeHtml(order.deliveryAddress || customer.address || customer.area || 'Not provided')}</div><div><strong>Current status</strong><br>${escapeHtml(deliveryStatusLabel(order.status))}</div>${acceptedTime}<div class="delivery-items"><strong>Delivery products</strong>${(order.items || []).filter((item) => item.fulfillment === 'delivery').map((item) => `<span>${escapeHtml(item.productName)} × ${Number(item.quantity) || 0}</span>`).join('')}</div></div><div class="delivery-action"><button data-order-id="${escapeHtml(order._id)}" data-next-status="${escapeHtml(next || '')}" ${next ? '' : 'disabled'}>${escapeHtml(actionText || 'Complete')}</button><button type="button" data-cancel-delivery="${escapeHtml(order._id)}" ${terminal ? 'disabled' : ''}>Cancel Order</button></div></article>`;
}

async function loadDeliveryOrders() {
  if (isDeliveryLogin) return;
  try {
    const data = await deliveryApi('/delivery-orders');
    document.getElementById('deliveryOrders').innerHTML = data.orders?.length ? data.orders.map(orderCard).join('') : '<div class="empty-delivery">You have no assigned orders right now.</div>';
    document.querySelectorAll('[data-next-status]').forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true;
      try { await deliveryApi(`/delivery-orders/${button.dataset.orderId}/status`, { method: 'PUT', body: JSON.stringify({ status: button.dataset.nextStatus }) }); await loadDeliveryOrders(); }
      catch (error) { deliveryMessage.textContent = error.message; await loadDeliveryOrders(); }
    }));
    document.querySelectorAll('[data-cancel-delivery]').forEach((button) => button.addEventListener('click', async () => {
      if (button.disabled || !window.confirm('Are you sure you want to cancel this order?')) return;
      button.disabled = true;
      try {
        await deliveryApi(`/delivery-orders/${button.dataset.cancelDelivery}/status`, {
          method: 'PUT',
          body: JSON.stringify({ status: 'CANCELLED' })
        });
        await loadDeliveryOrders();
      } catch (error) {
        deliveryMessage.textContent = error.message;
        await loadDeliveryOrders();
      }
    }));
  } catch (error) { deliveryMessage.textContent = error.message; }
}

if (!isDeliveryLogin) loadDeliveryOrders();

document.getElementById('deliveryLogout')?.addEventListener('click', () => { localStorage.removeItem('sattwikDeliveryToken'); localStorage.removeItem('sattwikDeliveryMember'); window.location.href = '/delivery/login.html'; });

// Change password functionality
const changePasswordModal = document.getElementById('changePasswordModal');
const changePasswordBtn = document.getElementById('changePasswordBtn');
const closePasswordModal = document.getElementById('closePasswordModal');
const changePasswordForm = document.getElementById('changePasswordForm');
const passwordMessage = document.getElementById('passwordMessage');

changePasswordBtn?.addEventListener('click', () => {
  changePasswordModal.style.display = 'block';
  changePasswordForm.reset();
  passwordMessage.textContent = '';
});

closePasswordModal?.addEventListener('click', () => {
  changePasswordModal.style.display = 'none';
});

changePasswordForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  passwordMessage.textContent = 'Updating password...';
  try {
    const response = await fetch('/api/delivery-auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deliveryToken}` },
      body: JSON.stringify({
        currentPassword: document.getElementById('currentPassword').value,
        newPassword: document.getElementById('newPassword').value,
        confirmPassword: document.getElementById('confirmPassword').value
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Password change failed');
    passwordMessage.textContent = data.message;
    if (data.reauthRequired) {
      setTimeout(() => {
        localStorage.removeItem('sattwikDeliveryToken');
        localStorage.removeItem('sattwikDeliveryMember');
        window.location.href = '/delivery/login.html';
      }, 1500);
    }
  } catch (error) {
    passwordMessage.textContent = error.message;
  }
});

if (!isDeliveryLogin) {
  deliveryApi('/delivery-auth/me').then((data) => { 
    document.getElementById('memberName').textContent = data.member.name;
  }).catch((error) => {
    console.error('Auth failed:', error);
    localStorage.removeItem('sattwikDeliveryToken'); 
    window.location.href = '/delivery/login.html';
  });
  const socket = window.io ? io({ auth: { token: deliveryToken } }) : null;
  socket?.on('order:updated', () => {
    loadDeliveryOrders();
    // Refresh performance data if performance tab is active
    const perfTab = document.querySelector('.delivery-tab[data-tab="performance"]');
    if (perfTab && perfTab.classList.contains('active')) {
      loadPerformanceData();
    }
  });
}

// Tab switching
document.querySelectorAll('.delivery-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;
    
    // Update tab buttons
    document.querySelectorAll('.delivery-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    
    // Update tab content
    document.querySelectorAll('.delivery-tab-content').forEach((content) => content.classList.remove('active'));
    document.getElementById(`${tabName}Tab`).classList.add('active');
    
    // Load performance data when switching to performance tab
    if (tabName === 'performance') {
      loadPerformanceData();
    }
  });
});

// Performance section
let perfHistoryPage = 0;
const perfHistoryPageSize = 50;

async function loadPerformanceData() {
  try {
    const { year, month, fromDate, toDate } = getPerfFilters();
    
    // Build query parameters, omitting undefined values
    const queryParams = {};
    if (year !== undefined) queryParams.year = year;
    if (month !== undefined) queryParams.month = month;
    if (fromDate !== undefined) queryParams.fromDate = fromDate;
    if (toDate !== undefined) queryParams.toDate = toDate;
    queryParams.skip = perfHistoryPage * perfHistoryPageSize;
    queryParams.limit = perfHistoryPageSize;
    
    const data = await deliveryApi(`/delivery-members/me?${new URLSearchParams(queryParams)}`);
    
    // Populate member info
    document.getElementById('perfMemberName').textContent = data.member?.name || '';
    document.getElementById('perfMemberEmail').textContent = data.member?.email || '';
    document.getElementById('perfMemberPhone').textContent = data.member?.phone || '';
    document.getElementById('perfMemberStatus').textContent = data.member?.active ? 'Active' : 'Inactive';
    document.getElementById('perfTotalCount').textContent = data.totalCount || 0;
    
    // Update filtered count
    document.getElementById('perfFilteredCount').textContent = data.periodCount || 0;
    
    // Render history table
    renderPerfHistoryTable(data.history);
    
    // Update pagination
    const historyTotal = data.historyTotal || 0;
    const totalPages = Math.ceil(historyTotal / perfHistoryPageSize);
    document.getElementById('perfHistoryPagination').hidden = totalPages <= 1;
    document.getElementById('perfHistoryPageInfo').textContent = `Page ${perfHistoryPage + 1} of ${totalPages || 1}`;
    document.getElementById('perfHistoryPrev').disabled = perfHistoryPage === 0;
    document.getElementById('perfHistoryNext').disabled = perfHistoryPage >= totalPages - 1;
  } catch (error) {
    console.error('Failed to load performance data:', error);
    document.getElementById('perfHistoryTable').innerHTML = `<p>Could not load delivery history: ${error.message}</p>`;
  }
}

function getPerfFilters() {
  const period = document.getElementById('perfPeriodFilter').value;
  const month = document.getElementById('perfMonthFilter').value;
  const fromDate = document.getElementById('perfFromDate').value;
  const toDate = document.getElementById('perfToDate').value;
  
  if (period === 'month' && month) {
    const [year, monthNum] = month.split('-');
    return { year: parseInt(year), month: parseInt(monthNum) };
  } else if (period === 'custom') {
    return { fromDate, toDate };
  }
  // For "all time", return empty object - no date filters
  return {};
}

function renderPerfHistoryTable(history) {
  const table = document.getElementById('perfHistoryTable');
  
  if (!history || history.length === 0) {
    table.innerHTML = '<p>No deliveries found for the selected period.</p>';
    return;
  }
  
  table.innerHTML = `
    <table>
      <thead><tr>
        <th>Delivery Date</th>
        <th>Order ID</th>
        <th>Customer</th>
        <th>Contact</th>
        <th>Item/Plan</th>
        <th>Amount</th>
      </tr></thead>
      <tbody>
        ${history.map((record) => {
          const customer = record.customerSnapshot || {};
          const delivery = record.deliverySnapshot || {};
          const deliveryDate = new Date(record.deliveryDate);
          const dateStr = deliveryDate.toLocaleDateString('en-US', { 
            timeZone: 'America/Vancouver',
            year: 'numeric',
            month: 'short',
            day: 'numeric'
          });
          
          let itemDisplay = delivery.orderType || 'Product';
          if (delivery.orderType === 'tiffin' && delivery.tiffinPlan) {
            const size = delivery.tiffinPlan.size ? delivery.tiffinPlan.size.charAt(0).toUpperCase() + delivery.tiffinPlan.size.slice(1) : '';
            const type = delivery.tiffinPlan.packageType === 'curry-only' ? 'Curry-Only' : 'Full Meal';
            itemDisplay = `${type} (${size})`;
          }
          
          return `
            <tr>
              <td>${dateStr}</td>
              <td>${escapeHtml(record.orderId)}</td>
              <td>${escapeHtml(`${customer.firstName || ''} ${customer.lastName || ''}`.trim())}</td>
              <td>${escapeHtml(customer.phone || '')}</td>
              <td>${escapeHtml(itemDisplay)}</td>
              <td>${money(record.orderAmount)}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

// Filter controls
document.getElementById('perfPeriodFilter')?.addEventListener('change', (e) => {
  const period = e.target.value;
  const monthLabel = document.getElementById('perfMonthFilterLabel');
  const customLabel = document.getElementById('perfCustomDateFilterLabel');
  const customLabel2 = document.getElementById('perfCustomDateFilterLabel2');
  
  monthLabel.hidden = period !== 'month';
  customLabel.hidden = period !== 'custom';
  customLabel2.hidden = period !== 'custom';
  
  if (period === 'all') {
    perfHistoryPage = 0;
    loadPerformanceData();
  }
});

document.getElementById('perfApplyFilter')?.addEventListener('click', () => {
  const period = document.getElementById('perfPeriodFilter').value;
  const month = document.getElementById('perfMonthFilter').value;
  const fromDate = document.getElementById('perfFromDate').value;
  const toDate = document.getElementById('perfToDate').value;
  const msgEl = document.getElementById('perfFilterMessage');
  
  msgEl.textContent = '';
  
  if (period === 'custom' && fromDate && toDate && new Date(fromDate) > new Date(toDate)) {
    msgEl.textContent = 'From date must be before or equal to To date.';
    return;
  }
  
  perfHistoryPage = 0;
  loadPerformanceData();
});

document.getElementById('perfClearFilter')?.addEventListener('click', () => {
  document.getElementById('perfPeriodFilter').value = 'all';
  document.getElementById('perfMonthFilterLabel').hidden = true;
  document.getElementById('perfCustomDateFilterLabel').hidden = true;
  document.getElementById('perfCustomDateFilterLabel2').hidden = true;
  document.getElementById('perfFromDate').value = '';
  document.getElementById('perfToDate').value = '';
  document.getElementById('perfFilterMessage').textContent = '';
  perfHistoryPage = 0;
  loadPerformanceData();
});

// Pagination
document.getElementById('perfHistoryPrev')?.addEventListener('click', () => {
  if (perfHistoryPage > 0) {
    perfHistoryPage--;
    loadPerformanceData();
  }
});

document.getElementById('perfHistoryNext')?.addEventListener('click', () => {
  perfHistoryPage++;
  loadPerformanceData();
});
