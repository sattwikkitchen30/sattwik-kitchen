const API_PREFIX = '/api';
let token = localStorage.getItem('sattwikToken') || '';
let state = { overview: null, orders: [], products: [], customers: [], custom: null, ordersFulfillment: 'delivery' };
let tiffinEditorOrder = null;
let tiffinEditorItems = [];
let tiffinEditorProducts = [];

const loginForm = document.getElementById('loginForm');
const loginMessage = document.getElementById('loginMessage');
const adminName = document.getElementById('adminName');

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
 
function setMessage(element, text, isSuccess = false) {
  if (!element) return;
  element.textContent = text;
  element.classList.toggle('success', Boolean(isSuccess));
}

let adminDateSaveToastTimer;
function showAdminToast(message) {
  const toast = document.getElementById('adminDateSaveToast');
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(adminDateSaveToastTimer);
  adminDateSaveToastTimer = setTimeout(() => { toast.hidden = true; }, 3000);
}

function showAdminDateSaveToast() {
  showAdminToast('Changes saved successfully.');
}

function getAuthHeaders() {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_PREFIX}${path}`, {
    ...options,
    headers,
    credentials: 'include'
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text || 'Request failed' }; }
  if (!response.ok) throw new Error(data.message || 'Request failed');
  return data;
}

async function loginAdmin(email, password) {
  const data = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  token = data.token;
  localStorage.setItem('sattwikToken', token);
  return data.admin;
}

function redirectToDashboard() {
  if (window.location.pathname.endsWith('/login.html')) {
    window.location.href = '/admin/dashboard.html';
  }
}

async function loadProfile() {
  try {
    const data = await api('/auth/me');
    adminName.textContent = data.admin?.name || 'Owner';
    if (window.io && !window.adminSocket) {
      window.adminSocket = io({ auth: { token } });
      window.adminSocket.on('order:updated', loadDashboardData);
    }
    document.documentElement.removeAttribute('data-admin-auth-pending');
    if (window.location.pathname.endsWith('/dashboard.html')) {
      loadDashboardData();
      loadAdmins();
    }
    redirectToDashboard();
  } catch (error) {
    localStorage.removeItem('sattwikToken');
    token = '';
    if (window.location.pathname.endsWith('/dashboard.html')) {
      window.location.href = '/admin/login.html';
    }
  }
}

if (loginForm) {
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value.trim();
    loginMessage.textContent = 'Signing in...';

    try {
      const admin = await loginAdmin(email, password);
      loginMessage.textContent = `Welcome ${admin.name || admin.email}`;
      window.location.href = '/admin/dashboard.html';
    } catch (error) {
      loginMessage.textContent = error.message || 'Login failed';
    }
  });
}

if (window.location.pathname.endsWith('/dashboard.html')) {
  loadProfile();
  const scheduleServiceDayRefresh = () => {
    const nextMidnight = new Date();
    nextMidnight.setHours(24, 0, 0, 50);
    window.setTimeout(() => {
      if (state.ordersFulfillment === 'delivery') renderOrdersTable();
      scheduleServiceDayRefresh();
    }, nextMidnight.getTime() - Date.now());
  };
  scheduleServiceDayRefresh();

  const navButtons = document.querySelectorAll('.nav-item');
  const views = document.querySelectorAll('.view-panel');
  navButtons.forEach((button) => {
    button.addEventListener('click', () => {
      navButtons.forEach((btn) => btn.classList.toggle('active', btn === button));
      views.forEach((view) => view.classList.toggle('active', view.id === `${button.dataset.view}View`));
    });
  });

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch (error) {
      console.warn(error.message || 'Logout failed');
    }
    localStorage.removeItem('sattwikToken');
    token = '';
    window.location.href = '/admin/login.html';
  });

  document.getElementById('refreshBtn')?.addEventListener('click', loadDashboardData);
  document.querySelectorAll('[data-export]').forEach((button) => {
    button.addEventListener('click', () => exportData(button.dataset.export));
  });

  document.getElementById('statusFilter')?.addEventListener('change', loadDashboardData);
  document.getElementById('typeFilter')?.addEventListener('change', loadDashboardData);
  document.getElementById('fromDate')?.addEventListener('change', loadDashboardData);
  document.getElementById('toDate')?.addEventListener('change', loadDashboardData);
  document.querySelectorAll('[data-fulfillment-tab]').forEach((button) => button.addEventListener('click', async () => {
    state.ordersFulfillment = button.dataset.fulfillmentTab;
    document.querySelectorAll('[data-fulfillment-tab]').forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    await renderOrdersTable();
  }));

}

function getLocalDateString(date = new Date()) {
  const value = new Date(date);
  const offset = value.getTimezoneOffset();
  return new Date(value.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function currency(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
}

function pickupStatusForOrder(order, items) {
  const rawStatus = String(items.find((item) => item.fulfillment === 'pickup')?.deliveryStatus || (order.fulfillment === 'pickup' ? order.status : 'PENDING')).toUpperCase();
  if (rawStatus === 'CANCELLED') return 'CANCELLED';
  if (rawStatus === 'DELIVERED') return 'DELIVERED';
  if (['ACCEPTED', 'CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'].includes(rawStatus)) return 'ACCEPTED';
  return 'PENDING';
}

function pickupStatusLabel(status) {
  return ({ PENDING: 'Pending', ACCEPTED: 'Accepted', DELIVERED: 'Pickup Completed', CANCELLED: 'Cancelled' })[status] || status;
}

function deliveryStatusLabel(status) {
  return ({
    PENDING: 'Pending',
    ACCEPTED: 'Accepted',
    OUT_FOR_DELIVERY: 'Out for Delivery',
    DELIVERED: 'Delivered',
    CANCELLED: 'Cancelled'
  })[status] || status;
}

function renderDeliveryStatusOptions(status, includeCancelled = false) {
  const values = ['PENDING', 'ACCEPTED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
  if (includeCancelled) values.push('CANCELLED');
  return values.map((value) => `<option value="${value}" ${status === value ? 'selected' : ''}>${deliveryStatusLabel(value)}</option>`).join('');
}

function renderPickupStatusControl(orderId, status) {
  const options = ['PENDING', 'ACCEPTED', 'DELIVERED', 'CANCELLED']
    .map((value) => `<option value="${value}" ${value === status ? 'selected' : ''}>${pickupStatusLabel(value)}</option>`)
    .join('');
  return `<select class="pickup-status-select" data-order-id="${orderId}" data-current-status="${status}">${options}</select>`;
}

function dateLabel(date) {
  const d = new Date(date);
  if (Number.isNaN(d.valueOf())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function pickupDateLabel(value) {
  if (!value) return '—';
  const dateKey = typeof value === 'string' ? value.slice(0, 10) : getLocalDateString(value);
  const date = new Date(`${dateKey}T12:00:00`);
  return Number.isNaN(date.valueOf()) ? '—' : dateLabel(date);
}

function toDateOnly(dateValue) {
  let dateKey;
  if (typeof dateValue === 'string') {
    const match = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/.exec(dateValue);
    dateKey = match?.[1] || null;
  } else {
    const value = new Date(dateValue);
    if (!Number.isNaN(value.getTime())) {
      dateKey = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    }
  }
  if (!dateKey) return null;
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function getDateInputValue(dateValue) {
  const value = new Date(dateValue);
  if (typeof dateValue === 'string') {
    const match = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/.exec(dateValue);
    if (match) return toDateOnly(dateValue) ? match[1] : '';
  }
  if (Number.isNaN(value.getTime())) return '';
  return getLocalDateString(value);
}

function getTiffinRowState(startDate, endDate) {
  const finalStart = toDateOnly(startDate);
  const finalEnd = toDateOnly(endDate);
  const today = toDateOnly(new Date());
  if (!finalEnd || !today) return '';
  if (finalEnd < today) return 'row-expired';
  if (finalStart && finalStart.getTime() === finalEnd.getTime()) return 'row-expired';
  if (finalStart) {
    const diff = (finalEnd - finalStart) / (1000 * 60 * 60 * 24);
    if (diff >= 0 && diff <= 3) return 'row-warning';
  }
  return '';
}

function parseFilters() {
  const params = new URLSearchParams();
  const status = document.getElementById('statusFilter')?.value ?? '';
  const type = document.getElementById('typeFilter')?.value ?? '';
  const from = document.getElementById('fromDate')?.value ?? '';
  const to = document.getElementById('toDate')?.value ?? '';
  if (status) params.set('status', status);
  if (type) params.set('type', type);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  return params;
}

async function loadDashboardData() {
  try {
    const params = parseFilters();
    const [overview, revenue, products, categories, customers, orderStatus, custom] = await Promise.all([
      api(`/analytics/overview?${params.toString()}`),
      api(`/analytics/revenue?group=day&${params.toString()}`),
      api(`/analytics/products?${params.toString()}`),
      api(`/analytics/categories?${params.toString()}`),
      api(`/analytics/customers?${params.toString()}`),
      api(`/analytics/order-status?${params.toString()}`),
      api(`/analytics/custom?${params.toString()}`)
    ]);

    state.overview = overview;
    renderStats(overview);
    renderRevenueChart(revenue);
    renderStatusChart(orderStatus);
    renderTopProducts(products);
    renderCustomerInsights(customers);
    renderCustomTable(custom);
    renderOrdersTable();
    renderProductsTable();
    await renderCustomersTable();
    await renderDeliveryMembersTable();
    renderExports();
    await loadTiffinPreparation();
  } catch (error) {
    console.error(error);
  }
}

async function loadTiffinPreparation(dateString = state.tiffinPreparationDate || getLocalDateString(new Date())) {
  state.tiffinPreparationDate = dateString;
  const datePicker = document.getElementById('prepDatePicker');
  const dateLabelEl = document.getElementById('prepDateLabel');
  const statusMessage = document.getElementById('prepStatusMessage');
  const content = document.getElementById('tiffinPreparationContent');
  if (!datePicker || !dateLabelEl || !content) return;

  datePicker.value = dateString;
  dateLabelEl.textContent = new Date(`${dateString}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  try {
    const data = await api(`/analytics/tiffin-preparation?date=${encodeURIComponent(dateString)}`, { cache: 'no-store' });
    const totals = data.totals || {};
    const counts = data.activePlanCounts || { full: { single: 0, couple: 0, family: 0 }, 'curry-only': { single: 0, couple: 0, family: 0 } };
    const selectedMenu = data.selectedMenu || { dalOption: 'Not selected', curryOption: 'Not selected' };
    const menu = data.menu || null;

    statusMessage.textContent = data.message || '';

    if (!data.serviceExists || !menu) {
      content.innerHTML = `
        <div class="prep-empty-state">
          <strong>No tiffin service on this day.</strong>
        </div>
      `;
      return;
    }

    const dailyItemRows = [
      { item: 'Dal', quantity: 'Small', count: totals.smallDal || 0 },
      { item: 'Dal', quantity: 'Medium', count: totals.mediumDal || 0 },
      { item: 'Dal', quantity: 'Large', count: totals.largeDal || 0 },
      { item: 'Curries', quantity: 'Small', count: totals.smallCurries || 0 },
      { item: 'Curries', quantity: 'Medium', count: totals.mediumCurries || 0 },
      { item: 'Curries', quantity: 'Large', count: totals.largeCurries || 0 },
      { item: 'Curd', quantity: 'Small', count: totals.smallCurd || 0 },
      { item: 'Curd', quantity: 'Big', count: totals.bigCurd || 0 },
      { item: 'Rice', quantity: '—', count: totals.riceBoxes || 0 },
      { item: 'Chapathi', quantity: '—', count: totals.chapathiCount || 0 },
      ...(totals.otherItems || []).map((item) => ({ item: item.item, quantity: '—', count: item.count }))
    ];

    const menuRows = [
      `<li><strong>Dal:</strong> ${menu.dalOptions?.join(' / ') || 'Not available'}</li>`,
      `<li><strong>Curry:</strong> ${menu.curryOptions?.join(' / ') || 'Not available'}</li>`,
      `<li><strong>Rice:</strong> ${menu.rice?.join(' / ') || 'Not available'}</li>`,
      `<li><strong>Chapati:</strong> ${menu.chapati?.join(' / ') || 'Not available'}</li>`,
      `<li><strong>Curd:</strong> ${menu.curd?.join(' / ') || 'Not available'}</li>`
    ];

    content.innerHTML = `
      <div class="tiffin-prep-grid">
        <div class="panel card prep-card">
          <div class="panel-head"><h3>Today’s Menu</h3></div>
          <ul class="prep-menu-list">${menuRows.join('')}</ul>
          <div class="prep-capture-controls">
            <label>
              <span>Dal</span>
              <select id="prepDalOptionSelect">
                <option value="Not selected" ${selectedMenu.dalOption === 'Not selected' ? 'selected' : ''}>Not selected</option>
                ${menu.dalOptions.map((option) => `<option value="${option}" ${selectedMenu.dalOption === option ? 'selected' : ''}>${option}</option>`).join('')}
              </select>
            </label>
            <label>
              <span>Curry</span>
              <select id="prepCurryOptionSelect">
                <option value="Not selected" ${selectedMenu.curryOption === 'Not selected' ? 'selected' : ''}>Not selected</option>
                ${menu.curryOptions.map((option) => `<option value="${option}" ${selectedMenu.curryOption === option ? 'selected' : ''}>${option}</option>`).join('')}
              </select>
            </label>
          </div>
        </div>

        <div class="panel card prep-card">
          <div class="panel-head"><h3>Active Tiffin Plans</h3></div>
          <div class="active-plan-group">
            <h4>Full Meal</h4>
            <p>Single: ${counts.full.single || 0}</p>
            <p>Couple: ${counts.full.couple || 0}</p>
            <p>Family: ${counts.full.family || 0}</p>
          </div>
          <div class="active-plan-group">
            <h4>Curry-Only</h4>
            <p>Single: ${counts['curry-only'].single || 0}</p>
            <p>Couple: ${counts['curry-only'].couple || 0}</p>
            <p>Family: ${counts['curry-only'].family || 0}</p>
          </div>
        </div>
      </div>

      <div class="panel card prep-card">
        <div class="panel-head"><h3>Daily Items</h3></div>
        <div class="prep-table-wrap">
          <table class="prep-items-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Quantity</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              ${dailyItemRows.map((row) => `
                <tr>
                  <td>${escHtml(row.item)}</td>
                  <td>${row.quantity}</td>
                  <td>${row.count}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('prepDalOptionSelect')?.addEventListener('change', async (event) => {
      try {
        const dalValue = event.target.value || 'Not selected';
        const curryValue = document.getElementById('prepCurryOptionSelect')?.value || 'Not selected';
        await api('/analytics/tiffin-preparation/menu', {
          method: 'PUT',
          body: JSON.stringify({ date: dateString, dalOption: dalValue, curryOption: curryValue })
        });
        statusMessage.textContent = 'Menu choice saved.';
      } catch (error) {
        statusMessage.textContent = error.message || 'Could not save menu selection.';
      }
    });

    document.getElementById('prepCurryOptionSelect')?.addEventListener('change', async (event) => {
      try {
        const curryValue = event.target.value || 'Not selected';
        const dalValue = document.getElementById('prepDalOptionSelect')?.value || 'Not selected';
        await api('/analytics/tiffin-preparation/menu', {
          method: 'PUT',
          body: JSON.stringify({ date: dateString, dalOption: dalValue, curryOption: curryValue })
        });
        statusMessage.textContent = 'Menu choice saved.';
      } catch (error) {
        statusMessage.textContent = error.message || 'Could not save menu selection.';
      }
    });
  } catch (error) {
    statusMessage.textContent = error.message || 'Could not load tiffin preparation data.';
    content.innerHTML = '<div class="prep-empty-state"><strong>Could not load data.</strong></div>';
  }
}

function bindTiffinPreparationControls() {
  const prevDayBtn = document.getElementById('prepPrevDay');
  if (prevDayBtn) {
    prevDayBtn.addEventListener('click', () => {
      const date = new Date(`${state.tiffinPreparationDate || getLocalDateString(new Date())}T12:00:00`);
      date.setDate(date.getDate() - 1);
      loadTiffinPreparation(getLocalDateString(date));
    });
  }

  const nextDayBtn = document.getElementById('prepNextDay');
  if (nextDayBtn) {
    nextDayBtn.addEventListener('click', () => {
      const date = new Date(`${state.tiffinPreparationDate || getLocalDateString(new Date())}T12:00:00`);
      date.setDate(date.getDate() + 1);
      loadTiffinPreparation(getLocalDateString(date));
    });
  }

  const datePicker = document.getElementById('prepDatePicker');
  if (datePicker) {
    datePicker.addEventListener('change', () => {
      if (datePicker.value) loadTiffinPreparation(datePicker.value);
    });
  }
}

if (window.location.pathname.endsWith('/dashboard.html')) {
  bindTiffinPreparationControls();
}

function renderStats(data) {
  const cards = [
    { label: 'Total orders', value: data.totalOrders || 0 },
    { label: 'Revenue', value: currency(data.totalRevenue) },
    { label: 'Pending', value: data.pendingOrders || 0 },
    { label: 'Delivered', value: data.completedOrders || 0 }
  ];

  document.getElementById('statsGrid').innerHTML = cards.map((card) => `
    <div class="stat-card">
      <small>${card.label}</small>
      <strong>${card.value}</strong>
    </div>
  `).join('');
}

function renderRevenueChart(data) {
  const canvas = document.getElementById('revenueChart');
  if (!canvas) return;
  if (window.revenueChartInstance) window.revenueChartInstance.destroy();
  window.revenueChartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels: data.labels || [],
      datasets: [{
        label: 'Revenue',
        data: data.revenue || [],
        borderColor: '#0c7a62',
        backgroundColor: 'rgba(12,122,98,.15)',
        tension: 0.3,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

function renderStatusChart(data) {
  const canvas = document.getElementById('statusChart');
  if (!canvas) return;
  if (window.statusChartInstance) window.statusChartInstance.destroy();
  window.statusChartInstance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: (data.statuses || []).map((x) => x.status),
      datasets: [{
        data: (data.statuses || []).map((x) => x.count),
        backgroundColor: ['#4a230f', '#0c7a62', '#c89b54', '#79a3ff', '#7fc4a7', '#c95f57']
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
  });
}

function renderTopProducts(products) {
  const rows = (products.products || []).slice(0, 5);
  document.getElementById('topProductsTable').innerHTML = `
    <table>
      <thead><tr><th>Product</th><th>Qty</th><th>Revenue</th></tr></thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${row.name}</td>
            <td>${row.quantity}</td>
            <td>${currency(row.revenue)}</td>
          </tr>
        `).join('') || '<tr><td colspan="3">No data</td></tr>'}
      </tbody>
    </table>
  `;
}

function renderCustomerInsights(customers) {
  const customerRows = (customers.byArea || []).slice(0, 5);
  document.getElementById('customerInsights').innerHTML = `
    <table>
      <thead><tr><th>Area</th><th>Orders</th><th>Revenue</th></tr></thead>
      <tbody>
        ${customerRows.map((row) => `
          <tr>
            <td>${row.area}</td>
            <td>${row.orders}</td>
            <td>${currency(row.revenue)}</td>
          </tr>
        `).join('') || '<tr><td colspan="3">No data</td></tr>'}
      </tbody>
    </table>
  `;
}

async function renderOrdersTable() {
  const params = parseFilters();
  params.set('fulfillment', state.ordersFulfillment || 'delivery');
  const data = await api(`/orders?${params.toString()}`);
  let deliveryMembers = [];
  if (state.ordersFulfillment === 'delivery') try {
    const deliveryMembersData = await api('/delivery-members');
    deliveryMembers = deliveryMembersData.members || [];
  } catch (error) {
    console.error('Failed to load delivery members:', error);
  }
  const orders = data.orders || [];
  const table = document.getElementById('ordersTable');
  const headers = state.ordersFulfillment === 'delivery'
    ? ['Order ID', 'Customer Name', 'Contact Details', 'Item', 'Type', 'Start Date', 'End Date', 'Delivery Member', 'Amount', 'Status']
    : ['Order', 'Customer / contact', 'Items', 'Type', 'Fulfillment', 'Date', 'Pickup Date', 'Status', 'Section total'];

  table.innerHTML = `
    <table>
      <thead>
        <tr>
          ${headers.map((label) => `<th>${label}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${orders.map((order) => {
          const items = order.items || [];
          const pickupStatus = pickupStatusForOrder(order, items);
          const customer = order.customerDoc || {};
          const customerName = [customer.firstName, customer.lastName].filter(Boolean).join(' ') || '—';
          const isTiffinDelivery = order.type === 'tiffin' && items.some((item) => item.fulfillment === 'delivery');

          if (state.ordersFulfillment === 'delivery' && isTiffinDelivery) {
            const matchedItem = items.find((item) => item.fulfillment === 'delivery');
            const itemName = matchedItem?.productName || (
              order.tiffinPlan?.packageType
                ? `${order.tiffinPlan.packageType === 'curry-only' ? 'Curry-Only' : 'Full Meal'} Package`
                : 'Tiffin Plan'
            );
            const tiffinStatus = String(order.status || 'PENDING').toUpperCase();
            const startDate = order.subscriptionStartDate;
            const endDate = order.subscriptionEndDate || order.createdAt;
            const rowState = getTiffinRowState(startDate, endDate);
            const amount = currency(order.totalAmount || (order.tiffinPlan?.price || 0));
            return `
              <tr class="${rowState}" data-order-id="${order._id}">
                <td>${order.orderId}</td>
                <td><strong>${customerName}</strong></td>
                <td>${customer.phone || '—'}<br>${customer.email || '—'}</td>
                <td>${escHtml(itemName)}<br><button type="button" class="edit-tiffin-items-btn" data-order-id="${order._id}">Edit Items</button></td>
                <td>${order.type}</td>
                <td>
                  <div class="tiffin-end-date-cell">
                    <input type="date" class="delivery-start-date-input" data-order-id="${order._id}" value="${startDate ? getDateInputValue(startDate) : ''}" />
                      <button class="delivery-start-date-save" data-order-id="${order._id}">Save</button>
                  </div>
                </td>
                <td>
                  <div class="tiffin-end-date-cell">
                    <input type="date" class="delivery-end-date-input" data-order-id="${order._id}" value="${getDateInputValue(endDate)}" />
                    <button class="delivery-end-date-save" data-order-id="${order._id}">Save</button>
                  </div>
                </td>
                <td>
                  <select class="delivery-member-select" data-order-id="${order._id}" data-current-member="${order.deliveryMemberId || ''}">
                    <option value="">Unassigned</option>
                    ${deliveryMembers.filter((member) => member.active !== false).map((member) => `<option value="${member.id}" ${String(order.deliveryMemberId || '') === String(member.id) ? 'selected' : ''}>${member.name}</option>`).join('')}
                  </select>
                </td>
                <td>${amount}</td>
                <td>
                  <select class="tiffin-status-select order-status-select" data-order-id="${order._id}" data-current-status="${tiffinStatus}">
                    ${renderDeliveryStatusOptions(tiffinStatus)}
                  </select>
                </td>
              </tr>
            `;
          }

          const itemDetails = items.map((it) => `${it.productName} × ${it.quantity} — ${currency(it.priceAtPurchase)} each; ${currency(it.subtotal)} (${it.fulfillment === 'delivery' ? 'Delivery' : 'Pickup'})`).join('<br>');
          const orderDetails = [itemDetails, order.customRequest ? `Custom request: ${order.customRequest}` : ''].filter(Boolean).join('<br>') || '—';
          const deliveryAddress = state.ordersFulfillment === 'delivery' ? `<br><strong>Address:</strong> ${escHtml(order.deliveryAddress || customer.address || customer.area || '—')}` : '<br><strong>Pickup:</strong> Customer pickup';
          const escapedCustomerName = escHtml(customerName);
          const escapedPhone = escHtml(customer.phone || '—');
          const escapedEmail = escHtml(customer.email || '—');
          const orderDateTime = new Date(order.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
          const deliveryAssignment = state.ordersFulfillment === 'delivery' ? `
            <td><select class="delivery-member-select" data-order-id="${order._id}" data-current-member="${order.deliveryMemberId || ''}">
              <option value="">Unassigned</option>
              ${deliveryMembers.filter((member) => member.active !== false).map((member) => `<option value="${member.id}" ${String(order.deliveryMemberId || '') === String(member.id) ? 'selected' : ''}>${escHtml(member.name)}</option>`).join('')}
            </select></td>` : '';
          return `
          <tr>
            <td>${order.orderId}</td>
            ${state.ordersFulfillment === 'delivery'
              ? `<td><strong>${escapedCustomerName}</strong></td><td>${escapedPhone}<br>${escapedEmail}${deliveryAddress}</td>`
              : `<td><strong>${escapedCustomerName}</strong><br>${escapedPhone}<br>${escapedEmail}${deliveryAddress}</td>`}
            <td>${orderDetails}</td>
            <td>${order.type}</td>
            ${state.ordersFulfillment === 'delivery'
              ? `<td><div class="tiffin-end-date-cell"><input type="date" class="delivery-start-date-input" data-order-id="${order._id}" value="${order.subscriptionStartDate ? getDateInputValue(order.subscriptionStartDate) : ''}" /><button class="delivery-start-date-save" data-order-id="${order._id}">Save</button></div></td><td><div class="tiffin-end-date-cell"><input type="date" class="delivery-end-date-input" data-order-id="${order._id}" value="${order.subscriptionEndDate ? getDateInputValue(order.subscriptionEndDate) : ''}" /><button class="delivery-end-date-save" data-order-id="${order._id}">Save</button></div></td>${deliveryAssignment}<td>${currency(order.totalAmount)}</td>`
              : `<td>Pickup</td><td>${orderDateTime}</td><td><div class="tiffin-end-date-cell pickup-date-editor" data-order-id="${order._id}"><input type="date" class="pickup-date-input" data-order-id="${order._id}" value="${order.pickupDate ? getDateInputValue(order.pickupDate) : ''}" /><button type="button" class="pickup-date-save" data-order-id="${order._id}">Save</button></div></td>`}
            <td>
              ${state.ordersFulfillment === 'delivery' ? `<select class="order-status-select" data-order-id="${order._id}" data-current-status="${order.status}">
                ${renderDeliveryStatusOptions(order.status, true)}
              </select><span class="badge ${String(order.status).toLowerCase()}">${deliveryStatusLabel(order.status)}</span>` : renderPickupStatusControl(order._id, pickupStatus)}
            </td>
            ${state.ordersFulfillment === 'pickup' ? `<td>${currency(order.totalAmount)}</td>` : ''}
          </tr>
        `;
        }).join('') || `<tr><td colspan="${state.ordersFulfillment === 'delivery' ? 10 : 9}">No ${state.ordersFulfillment} orders found.</td></tr>`}
      </tbody>
    </table>
  `;

  table.querySelectorAll('.edit-tiffin-items-btn').forEach((button) => button.addEventListener('click', async () => {
    try {
      await openTiffinItemsEditor(button.dataset.orderId);
    } catch (error) {
      showAdminToast(error.message || 'Could not open tiffin order items.');
    }
  }));

  table.querySelectorAll('.delivery-start-date-save').forEach((button) => button.addEventListener('click', async () => {
    const input = table.querySelector(`.delivery-start-date-input[data-order-id="${button.dataset.orderId}"]`);
    const startDate = input?.value;
    if (!startDate) return alert('Please choose a start date.');
    try {
      await api(`/orders/${button.dataset.orderId}/tiffin-end-date`, { method: 'PUT', body: JSON.stringify({ startDate }) });
      showAdminDateSaveToast();
      await renderOrdersTable();
    } catch (error) {
      alert(error.message || 'Could not update the start date');
    }
  }));

  table.querySelectorAll('.delivery-end-date-save').forEach((button) => button.addEventListener('click', async () => {
    const input = table.querySelector(`.delivery-end-date-input[data-order-id="${button.dataset.orderId}"]`);
    const endDate = input?.value;
    if (!endDate) return alert('Please choose an end date.');
    try {
      await api(`/orders/${button.dataset.orderId}/tiffin-end-date`, { method: 'PUT', body: JSON.stringify({ endDate }) });
      showAdminDateSaveToast();
      await renderOrdersTable();
    } catch (error) {
      alert(error.message || 'Could not update the end date');
    }
  }));

  table.querySelectorAll('.pickup-date-save').forEach((button) => button.addEventListener('click', async () => {
    const input = table.querySelector(`.pickup-date-input[data-order-id="${button.dataset.orderId}"]`);
    if (!input?.value) return alert('Please choose a pickup date.');
    try {
      await api(`/orders/${button.dataset.orderId}/pickup-date`, { method: 'PUT', body: JSON.stringify({ pickupDate: input.value }) });
      showAdminDateSaveToast();
      await renderOrdersTable();
    } catch (error) {
      alert(error.message || 'Could not update the pickup date');
    }
  }));

  table.querySelectorAll('.order-status-select').forEach((select) => select.addEventListener('change', async () => {
    const previous = select.dataset.currentStatus;
    if (select.value === 'OUT_FOR_DELIVERY') {
      const memberSelect = table.querySelector(`.delivery-member-select[data-order-id="${select.dataset.orderId}"]`);
      if (!memberSelect?.value) {
        select.value = previous;
        showAdminToast('Choose a delivery member');
        return;
      }
    }
    try {
      await api(`/orders/${select.dataset.orderId}/status`, { method: 'PUT', body: JSON.stringify({ status: select.value }) });
      await loadDashboardData();
    } catch (error) {
      select.value = previous;
      alert(error.message || 'Status update failed');
    }
  }));
  table.querySelectorAll('.delivery-member-select').forEach((select) => select.addEventListener('change', async () => {
    const previous = select.dataset.currentMember;
    if (!select.value) {
      select.value = previous;
      return;
    }
    try {
      await api(`/orders/${select.dataset.orderId}/assign`, { method: 'PUT', body: JSON.stringify({ deliveryMemberId: select.value }) });
      await loadDashboardData();
    } catch (error) {
      select.value = previous;
      alert(error.message || 'Assignment failed');
    }
  }));
  table.querySelectorAll('.pickup-status-select').forEach((select) => select.addEventListener('change', async () => {
    const previous = select.dataset.currentStatus;
    try {
      await api(`/orders/${select.dataset.orderId}/status`, { method: 'PUT', body: JSON.stringify({ status: select.value, fulfillment: 'pickup' }) });
      await loadDashboardData();
    } catch (error) {
      select.value = previous;
      alert(error.message || 'Pickup status update failed');
    }
  }));
  table.querySelectorAll('.assign-btn').forEach((btn) => btn.addEventListener('click', async () => {
    const select = table.querySelector(`.delivery-member-select[data-order-id="${btn.dataset.orderId}"]`);
    const deliveryMemberId = select.value;
    if (!deliveryMemberId) {
      alert('Please select a delivery member');
      return;
    }
    try {
      await api(`/orders/${btn.dataset.orderId}/assign`, { method: 'PUT', body: JSON.stringify({ deliveryMemberId }) });
      await loadDashboardData();
    } catch (error) {
      alert(error.message || 'Assignment failed');
    }
  }));
}

async function openTiffinItemsEditor(orderId) {
  const [orderResponse, productsResponse] = await Promise.all([
    api(`/orders/${orderId}`),
    api('/products/all?active=true')
  ]);
  const order = orderResponse.order;
  const isDeliveryTiffin = order?.type === 'tiffin'
    && (order.items || []).some((item) => item.fulfillment === 'delivery')
    && !(order.items || []).some((item) => item.fulfillment === 'pickup');
  if (!isDeliveryTiffin) throw new Error('Only delivery tiffin orders can edit preparation items.');

  tiffinEditorOrder = order;
  tiffinEditorItems = (order.tiffinItems || []).map((item) => ({ ...item }));
  tiffinEditorProducts = (productsResponse.products || []).filter((product) => product.active !== false);

  const customer = order.customer || {};
  const customerName = [customer.firstName, customer.lastName].filter(Boolean).join(' ') || '—';
  const packageItem = (order.items || []).find((item) => item.category === 'Tiffin Plans');
  const packageType = order.tiffinPlan?.packageType === 'curry-only'
    ? 'Curry-Only Package'
    : order.tiffinPlan?.packageType === 'full'
      ? 'Full Meal Package'
      : packageItem?.productName || 'Tiffin Package';
  const size = order.tiffinPlan?.size ? ` — ${order.tiffinPlan.size[0].toUpperCase()}${order.tiffinPlan.size.slice(1)}` : '';
  document.getElementById('tiffinItemsOrderSummary').innerHTML = `
    <div><strong>Order ID:</strong> ${escHtml(order.orderId || '—')}</div>
    <div><strong>Customer:</strong> ${escHtml(customerName)}</div>
    <div><strong>Package:</strong> ${escHtml(packageType + size)}${packageItem?.quantity > 1 ? ` × ${Number(packageItem.quantity)}` : ''}</div>
    <div><strong>Start Date:</strong> ${escHtml(order.subscriptionStartDate || '—')}</div>
    <div><strong>End Date:</strong> ${escHtml(order.subscriptionEndDate || '—')}</div>
  `;
  document.getElementById('tiffinAddItemProduct').innerHTML = `
    <option value="">Select a catalog product</option>
    ${tiffinEditorProducts.map((product) => `<option value="${escHtml(product._id)}">${escHtml(product.name)} (${escHtml(product.category || 'General')})</option>`).join('')}
  `;
  document.getElementById('tiffinAddItemQuantity').value = '1';
  document.getElementById('tiffinAddItemForm').hidden = true;
  document.getElementById('tiffinItemsMessage').textContent = '';
  renderTiffinEditorItems();
  const modal = document.getElementById('tiffinItemsModal');
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
}

function getTiffinEditorPreparationType(productName) {
  const name = String(productName || '').toLowerCase();
  const size = /\b(big|large)\b/.test(name)
    ? 'large'
    : /\b(medium|med)\b/.test(name)
      ? 'medium'
      : 'small';
  if (/\bdal\b/.test(name)) return `${size}Dal`;
  if (/\bcurr(?:y|ies)\b/.test(name)) return `${size}Curry`;
  if (/\bcurd\b/.test(name)) return size === 'large' ? 'bigCurd' : 'smallCurd';
  if (/\bchapathi\b|\bchapati\b|\bchapatti\b/.test(name)) return 'chapathi';
  if (/\brice\b/.test(name)) return 'riceBox';
  return null;
}

function renderTiffinEditorItems() {
  const list = document.getElementById('tiffinItemsList');
  list.innerHTML = tiffinEditorItems.length
    ? tiffinEditorItems.map((item, index) => `
      <div class="tiffin-item-row">
        <strong>${escHtml(item.productName)}</strong>
        <button type="button" class="tiffin-item-step" data-item-index="${index}" data-step="-1" aria-label="Decrease ${escHtml(item.productName)} quantity">−</button>
        <input class="tiffin-item-quantity" type="number" min="1" step="1" value="${Number(item.quantity)}" data-item-index="${index}" aria-label="${escHtml(item.productName)} quantity" />
        <button type="button" class="tiffin-item-step" data-item-index="${index}" data-step="1" aria-label="Increase ${escHtml(item.productName)} quantity">+</button>
        <button type="button" class="tiffin-item-remove" data-item-index="${index}">Remove</button>
      </div>
    `).join('')
    : '<p class="muted">No preparation items in this order.</p>';
}

function closeTiffinItemsEditor() {
  const modal = document.getElementById('tiffinItemsModal');
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  tiffinEditorOrder = null;
  tiffinEditorItems = [];
}

document.getElementById('tiffinItemsCloseBtn')?.addEventListener('click', closeTiffinItemsEditor);
document.getElementById('tiffinItemsCancelBtn')?.addEventListener('click', closeTiffinItemsEditor);
document.getElementById('tiffinItemsModal')?.addEventListener('click', (event) => {
  if (event.target === event.currentTarget) closeTiffinItemsEditor();
});

document.getElementById('tiffinAddItemToggle')?.addEventListener('click', () => {
  const form = document.getElementById('tiffinAddItemForm');
  form.hidden = !form.hidden;
  if (!form.hidden) document.getElementById('tiffinAddItemProduct').focus();
});

document.getElementById('tiffinItemsList')?.addEventListener('click', (event) => {
  const stepButton = event.target.closest('.tiffin-item-step');
  const removeButton = event.target.closest('.tiffin-item-remove');
  if (!stepButton && !removeButton) return;
  const index = Number((stepButton || removeButton).dataset.itemIndex);
  if (!Number.isInteger(index) || !tiffinEditorItems[index]) return;
  if (removeButton) {
    tiffinEditorItems.splice(index, 1);
  } else {
    const nextQuantity = Number(tiffinEditorItems[index].quantity) + Number(stepButton.dataset.step);
    tiffinEditorItems[index].quantity = Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, nextQuantity));
  }
  renderTiffinEditorItems();
});

document.getElementById('tiffinItemsList')?.addEventListener('change', (event) => {
  if (!event.target.matches('.tiffin-item-quantity')) return;
  const index = Number(event.target.dataset.itemIndex);
  const quantity = Number(event.target.value);
  if (!Number.isInteger(index) || !tiffinEditorItems[index]) return;
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    document.getElementById('tiffinItemsMessage').textContent = 'Quantity must be a positive whole number.';
    renderTiffinEditorItems();
    return;
  }
  tiffinEditorItems[index].quantity = quantity;
  document.getElementById('tiffinItemsMessage').textContent = '';
});

document.getElementById('tiffinAddItemForm')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const product = tiffinEditorProducts.find((item) => String(item._id) === document.getElementById('tiffinAddItemProduct').value);
  const quantity = Number(document.getElementById('tiffinAddItemQuantity').value);
  const message = document.getElementById('tiffinItemsMessage');
  if (!product) {
    message.textContent = 'Choose a catalog item to add.';
    return;
  }
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    message.textContent = 'Quantity must be a positive whole number.';
    return;
  }

  const preparationType = getTiffinEditorPreparationType(product.name);
  const existingItem = tiffinEditorItems.find((item) => (
    String(item.productId || '') === String(product._id)
    || (preparationType && item.preparationType === preparationType)
  ));
  if (existingItem) {
    const combinedQuantity = Number(existingItem.quantity) + quantity;
    if (!Number.isSafeInteger(combinedQuantity)) {
      message.textContent = 'The combined item quantity is too large.';
      return;
    }
    existingItem.quantity = combinedQuantity;
  } else {
    if (tiffinEditorItems.length >= 50) {
      message.textContent = 'An order can contain at most 50 preparation items.';
      return;
    }
    tiffinEditorItems.push({
      productId: product._id,
      productName: product.name,
      category: product.category,
      preparationType,
      quantity
    });
  }
  document.getElementById('tiffinAddItemProduct').value = '';
  document.getElementById('tiffinAddItemQuantity').value = '1';
  message.textContent = '';
  renderTiffinEditorItems();
});

document.getElementById('tiffinItemsSaveBtn')?.addEventListener('click', async (event) => {
  if (!tiffinEditorOrder) return;
  const button = event.currentTarget;
  const message = document.getElementById('tiffinItemsMessage');
  button.disabled = true;
  message.textContent = '';
  try {
    await api(`/orders/${tiffinEditorOrder._id}/tiffin-items`, {
      method: 'PUT',
      body: JSON.stringify({
        items: tiffinEditorItems.map((item) => ({
          productId: item.productId || null,
          preparationType: item.preparationType || null,
          quantity: Number(item.quantity)
        }))
      })
    });
    closeTiffinItemsEditor();
    showAdminToast('Order items updated successfully.');
    try {
      if (state.ordersFulfillment === 'delivery') await renderOrdersTable();
      await loadTiffinPreparation(state.tiffinPreparationDate);
    } catch (error) {
      console.error('Order items were saved, but the dashboard refresh failed:', error);
      showAdminToast(`Items saved, but refresh failed: ${error.message || 'Could not refresh preparation data.'}`);
    }
  } catch (error) {
    message.textContent = error.message || 'Could not save order items.';
  } finally {
    button.disabled = false;
  }
});

const manualOrderModal = document.getElementById('manualOrderModal');
const manualOrderForm = document.getElementById('manualOrderForm');
const manualPickupDateField = document.getElementById('manualPickupDateField');
const manualPickupDate = document.getElementById('manualPickupDate');
let manualOrderProducts = [];

function closeManualOrderModal() {
  if (!manualOrderModal || !manualOrderForm) return;
  manualOrderModal.hidden = true;
  manualOrderModal.setAttribute('aria-hidden', 'true');
  manualOrderForm.reset();
  document.getElementById('manualOrderMessage').textContent = '';
}

document.getElementById('addManualOrderBtn')?.addEventListener('click', async () => {
  const fulfillment = state.ordersFulfillment || 'delivery';
  document.getElementById('manualOrderTitle').textContent = `Add ${fulfillment === 'delivery' ? 'Delivery' : 'Pickup'} Order`;
  document.getElementById('manualOrderFulfillment').textContent = `${fulfillment === 'delivery' ? 'Delivery' : 'Pickup'} order`;
  document.getElementById('manualAddressLabel').hidden = fulfillment !== 'delivery';
  manualPickupDateField.hidden = false;
  manualPickupDate.required = true;
  manualPickupDate.min = getLocalDateString();
  try {
    const data = await api('/products/all');
    manualOrderProducts = (data.products || []).filter((product) => product.active !== false);
    const select = document.getElementById('manualProduct');
    select.innerHTML = '<option value="">Select a product</option>' + manualOrderProducts.map((product) =>
      `<option value="${product._id}" ${product.stock === 0 ? 'disabled' : ''}>${escHtml(product.name)} (${currency(product.price)}${product.stock === 0 ? ', out of stock' : ''})</option>`
    ).join('');
    document.getElementById('manualAmount').value = '';
    document.getElementById('manualOrderMessage').textContent = '';
    manualOrderModal.hidden = false;
    manualOrderModal.setAttribute('aria-hidden', 'false');
    document.getElementById('manualFirstName').focus();
  } catch (error) {
    alert(error.message || 'Could not load products.');
  }
});

function updateManualOrderAmount() {
  const product = manualOrderProducts.find((item) => String(item._id) === document.getElementById('manualProduct').value);
  const quantity = Number(document.getElementById('manualQuantity').value) || 1;
  document.getElementById('manualAmount').value = product ? (Number(product.price) * quantity).toFixed(2) : '';
}

document.getElementById('manualProduct')?.addEventListener('change', updateManualOrderAmount);
document.getElementById('manualQuantity')?.addEventListener('input', updateManualOrderAmount);
document.getElementById('manualOrderCloseBtn')?.addEventListener('click', closeManualOrderModal);
document.getElementById('manualOrderCancelBtn')?.addEventListener('click', closeManualOrderModal);
manualOrderModal?.addEventListener('click', (event) => {
  if (event.target === event.currentTarget) closeManualOrderModal();
});

manualOrderForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = document.getElementById('manualOrderSubmit');
  const message = document.getElementById('manualOrderMessage');
  const productId = document.getElementById('manualProduct').value;
  const product = manualOrderProducts.find((item) => String(item._id) === productId);
  const quantity = Number(document.getElementById('manualQuantity').value);
  const amount = Number(document.getElementById('manualAmount').value);
  const fulfillment = state.ordersFulfillment || 'delivery';
  if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 99 || !Number.isFinite(amount) || amount < 0) {
    message.textContent = 'Choose a product and enter a valid quantity and amount.';
    return;
  }
  if (!manualPickupDate.value) {
    message.textContent = 'Order date is required.';
    manualPickupDate.reportValidity();
    return;
  }
  if (!manualPickupDate.checkValidity()) {
    message.textContent = 'Order date must be today or a future date.';
    manualPickupDate.reportValidity();
    return;
  }
  submitButton.disabled = true;
  message.textContent = 'Creating order...';
  try {
    await api('/orders/manual', {
      method: 'POST',
      body: JSON.stringify({
        firstName: document.getElementById('manualFirstName').value.trim(),
        lastName: document.getElementById('manualLastName').value.trim(),
        phone: document.getElementById('manualPhone').value.trim(),
        email: document.getElementById('manualEmail').value.trim(),
        productId,
        quantity,
        amount,
        fulfillment,
        address: document.getElementById('manualAddress').value.trim(),
        pickupDate: manualPickupDate.value
      })
    });
    closeManualOrderModal();
    await loadDashboardData();
  } catch (error) {
    message.textContent = error.message || 'Could not create order.';
  } finally {
    submitButton.disabled = false;
  }
});

async function renderProductsTable() {
  const data = await api('/products/all');
  const products = data.products || [];

  // Populate the categories datalist in the edit modal with all unique categories
  // so the admin gets autocomplete suggestions when editing.
  const datalist = document.getElementById('existingCategoriesList');
  if (datalist) {
    const cats = [...new Set(products.map((p) => p.category).filter(Boolean))].sort();
    datalist.innerHTML = cats.map((c) => `<option value="${c}"></option>`).join('');
  }

  const table = document.getElementById('productsTable');
  table.innerHTML = `
    <table>
      <thead><tr>
        <th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th>Active</th><th>Actions</th>
      </tr></thead>
      <tbody>
        ${products.map((product) => `
          <tr data-product-id="${product._id}">
            <td>${escHtml(product.name)}</td>
            <td>${escHtml(product.category)}</td>
            <td>${currency(product.price)}</td>
            <td>
              <input class="stock-input" data-product-id="${product._id}"
                     type="number" min="0" step="1" value="${product.stock}" />
              <button class="stock-save" data-product-id="${product._id}">Save</button>
            </td>
            <td>${product.active ? 'Yes' : 'No'}</td>
            <td>
              <button class="product-action-btn edit-btn"
                      data-product-id="${product._id}">Edit</button>
              <button class="product-action-btn delete-btn"
                      data-product-id="${product._id}">Delete</button>
            </td>
          </tr>
        `).join('') || '<tr><td colspan="6">No products found</td></tr>'}
      </tbody>
    </table>
  `;

  // Stock-save (existing behaviour — unchanged)
  table.querySelectorAll('.stock-save').forEach((button) => button.addEventListener('click', async () => {
    const input = table.querySelector(`.stock-input[data-product-id="${button.dataset.productId}"]`);
    const stock = Number(input.value);
    if (!Number.isInteger(stock) || stock < 0) return alert('Stock must be a non-negative integer.');
    try {
      await api(`/products/${button.dataset.productId}/stock`, { method: 'PATCH', body: JSON.stringify({ stock }) });
      await renderProductsTable();
    } catch (error) { alert(error.message || 'Could not update stock'); }
  }));

  // Edit — open modal pre-filled with product data
  table.querySelectorAll('.edit-btn').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.productId;
    const product = products.find((p) => String(p._id) === id);
    if (!product) return;
    openEditModal(product);
  }));

  // Delete — confirm then call DELETE /api/products/:id
  table.querySelectorAll('.delete-btn').forEach((button) => button.addEventListener('click', async () => {
    const id = button.dataset.productId;
    const product = products.find((p) => String(p._id) === id);
    if (!product) return;
    if (!confirm(`Delete "${product.name}"?\n\nThis cannot be undone.`)) return;
    try {
      await api(`/products/${id}`, { method: 'DELETE' });
      await renderProductsTable();
    } catch (error) {
      alert(error.message || 'Could not delete product');
    }
  }));
}

// Simple HTML-escape to prevent XSS when injecting product names into the table
function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ===============================
// DELIVERY MEMBER MANAGEMENT
// ===============================
async function renderDeliveryMembersTable() {
  const data = await api('/delivery-members');
  const members = data.members || [];
  const table = document.getElementById('deliveryMembersTable');
  table.innerHTML = `
    <table>
      <thead><tr>
        <th>Name</th><th>Email</th><th>Phone</th><th>Active</th><th>Created</th>
      </tr></thead>
      <tbody>
        ${members.map((member) => `
          <tr>
            <td>${escHtml(member.name)}</td>
            <td>${escHtml(member.email)}</td>
            <td>${escHtml(member.phone)}</td>
            <td>${member.active ? 'Yes' : 'No'}</td>
            <td>${dateLabel(member.createdAt)}</td>
          </tr>
        `).join('') || '<tr><td colspan="5">No delivery members found</td></tr>'}
      </tbody>
    </table>
  `;
}

document.getElementById('addDeliveryMemberForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msgEl = document.getElementById('addDeliveryMessage');
  msgEl.textContent = '';

  const name = document.getElementById('newDeliveryName').value.trim();
  const email = document.getElementById('newDeliveryEmail').value.trim();
  const phone = document.getElementById('newDeliveryPhone').value.trim();
  const password = document.getElementById('newDeliveryPassword').value;
  const confirmPassword = document.getElementById('newDeliveryConfirmPassword').value;

  if (!name) { msgEl.textContent = 'Name is required.'; return; }
  if (!email) { msgEl.textContent = 'Email is required.'; return; }
  if (!phone) { msgEl.textContent = 'Phone is required.'; return; }
  if (!password || !confirmPassword) { msgEl.textContent = 'Password and confirm password are required.'; return; }
  if (password.length < 8) { msgEl.textContent = 'Password must be at least 8 characters.'; return; }
  if (password !== confirmPassword) { msgEl.textContent = 'Passwords do not match.'; return; }

  const submitBtn = document.getElementById('addDeliveryMemberForm').querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating…';

  try {
    await api('/delivery-members', {
      method: 'POST',
      body: JSON.stringify({ name, email, phone, password, confirmPassword })
    });
    setMessage(msgEl, 'Delivery member created successfully!', true);
    document.getElementById('addDeliveryMemberForm').reset();
    await renderDeliveryMembersTable();
  } catch (error) {
    msgEl.textContent = error.message || 'Could not create delivery member';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create delivery member';
  }
});

// -----------------------------------------------------------------------
// Product edit modal logic
// -----------------------------------------------------------------------

function openEditModal(product) {
  document.getElementById('editProductId').value = product._id;
  document.getElementById('editName').value = product.name || '';
  document.getElementById('editPrice').value = product.price ?? '';
  document.getElementById('editStock').value = product.stock ?? 0;
  document.getElementById('editImage').value =
    product.image === 'assets/product-placeholder.svg' ? '' : (product.image || '');
  document.getElementById('editActive').checked = product.active !== false;
  document.getElementById('editFormMessage').textContent = '';

  // Load categories and set current category
  loadCategoriesForEditModal(product.category);

  document.getElementById('productEditModal').hidden = false;
  document.getElementById('productEditModal').setAttribute('aria-hidden', 'false');
  document.getElementById('editName').focus();
}

async function loadCategoriesForEditModal(currentCategory) {
  try {
    const data = await api('/products/all');
    const products = data.products || [];
    
    // Extract unique categories (case-insensitive)
    const categoryMap = new Map();
    products.forEach((product) => {
      const normalized = product.category.toLowerCase().trim();
      if (!categoryMap.has(normalized)) {
        categoryMap.set(normalized, product.category); // Keep original casing
      }
    });
    
    const uniqueCategories = Array.from(categoryMap.values()).sort();
    
    // Populate category dropdown
    const select = document.getElementById('editCategorySelect');
    if (select) {
      // Keep the first two options
      select.innerHTML = '<option value="">Select category...</option><option value="+new">+ New Category</option>';
      
      // Add existing categories
      uniqueCategories.forEach((category) => {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = category;
        if (category === currentCategory) {
          option.selected = true;
        }
        select.appendChild(option);
      });
    }
  } catch (error) {
    console.error('Failed to load categories:', error);
  }
}

function closeEditModal() {
  document.getElementById('productEditModal').hidden = true;
  document.getElementById('productEditModal').setAttribute('aria-hidden', 'true');
  document.getElementById('productEditForm').reset();
  document.getElementById('editNewCategoryInput').style.display = 'none';
  document.getElementById('editFormMessage').textContent = '';
}

// Close via ×, Cancel button, or Escape key
document.getElementById('modalCloseBtn')?.addEventListener('click', closeEditModal);
document.getElementById('editCancelBtn')?.addEventListener('click', closeEditModal);
document.getElementById('productEditModal')?.addEventListener('click', (e) => {
  // Close if backdrop itself (not inner shell) is clicked
  if (e.target === e.currentTarget) closeEditModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeEditModal();
    closeAddModal();
    closeManualOrderModal();
  }
});

document.getElementById('editCategorySelect')?.addEventListener('change', (e) => {
  const newCategoryInput = document.getElementById('editNewCategoryInput');
  if (e.target.value === '+new') {
    newCategoryInput.style.display = 'block';
    newCategoryInput.required = true;
    newCategoryInput.focus();
  } else {
    newCategoryInput.style.display = 'none';
    newCategoryInput.required = false;
    newCategoryInput.value = '';
  }
});

// Save changes via PUT /api/products/:id
document.getElementById('productEditForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msgEl = document.getElementById('editFormMessage');
  msgEl.textContent = '';

  const id = document.getElementById('editProductId').value;
  const name = document.getElementById('editName').value.trim();
  const categorySelect = document.getElementById('editCategorySelect').value;
  const newCategoryInput = document.getElementById('editNewCategoryInput').value.trim();
  const price = parseFloat(document.getElementById('editPrice').value);
  const stock = parseInt(document.getElementById('editStock').value, 10);
  const imageRaw = document.getElementById('editImage').value.trim();
  const image = imageRaw || 'assets/product-placeholder.svg';
  const active = document.getElementById('editActive').checked;

  // Determine category
  let category;
  if (categorySelect === '+new') {
    category = newCategoryInput;
  } else {
    category = categorySelect;
  }

  // Client-side validation
  if (!name) { msgEl.textContent = 'Product name is required.'; return; }
  if (!category) { msgEl.textContent = 'Category is required.'; return; }
  if (!Number.isFinite(price) || price < 0) { msgEl.textContent = 'Enter a valid non-negative price.'; return; }
  if (!Number.isInteger(stock) || stock < 0) { msgEl.textContent = 'Stock must be a non-negative whole number.'; return; }

  const saveBtn = document.getElementById('editSaveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  try {
    await api(`/products/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name, category, price, stock, image, active })
    });
    setMessage(msgEl, 'Saved successfully!', true);
    // Refresh the products table so changes are immediately visible
    await renderProductsTable();
    // Close the modal after a short delay so the admin can see the success message
    setTimeout(closeEditModal, 900);
  } catch (error) {
    msgEl.textContent = error.message || 'Could not save changes.';
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save changes';
  }
});

async function renderCustomersTable() {
  const data = await api('/customers?limit=100');
  const rows = data.customers || [];
  document.getElementById('customersTable').innerHTML = `
    <table>
      <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Area</th><th>Address</th><th>Registered</th><th>Orders</th></tr></thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${row.firstName || ''} ${row.lastName || ''}</td>
            <td>${row.email || '—'}</td>
            <td>${row.phone || '—'}</td>
            <td>${row.area}</td>
            <td>${row.address || '—'}</td>
            <td>${dateLabel(row.createdAt)}</td>
            <td>${row.orders}</td>
          </tr>
        `).join('') || '<tr><td colspan="7">No customer data</td></tr>'}
      </tbody>
    </table>
  `;
}

function renderCustomTable(custom) {
  const rows = (custom.recent || []).slice(0, 10);
  const table = document.getElementById('customTable');
  const totalAmount = Number(custom.totalAmount || 0);
  table.innerHTML = `
    <table>
      <thead><tr><th>Type</th><th>Customer</th><th>Request</th><th>Status</th><th>Total</th></tr></thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${row.type}</td>
            <td>${row.customer ? `${row.customer.firstName} ${row.customer.lastName}` : '—'}</td>
            <td>${row.customRequest || '—'}</td>
            <td><span class="badge ${row.status}">${row.status}</span></td>
            <td>${currency(row.totalAmount)}</td>
          </tr>
        `).join('') || '<tr><td colspan="5">No custom orders</td></tr>'}
      </tbody>
      ${rows.length ? `<tfoot><tr><td colspan="4"><strong>Total</strong></td><td><strong>${currency(totalAmount)}</strong></td></tr></tfoot>` : ''}
    </table>
  `;
}

function renderExports() {
  // Placeholder; CSV export handled by browser download.
}

async function exportData(kind) {
  try {
    if (kind === 'demo-clear') {
      const result = await api('/clear-demo', { method: 'POST' });
      alert(result.message || 'Demo records cleared.');
      await loadDashboardData();
      return;
    }

    const params = parseFilters();
    const endpoint = kind === 'orders' ? 'orders.csv' : 'products.csv';
    const response = await fetch(`${API_PREFIX}/export/${endpoint}?${params.toString()}`, {
      headers: getAuthHeaders()
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || 'Export failed');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${kind}-export.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    alert(error.message || 'Export failed');
  }
}

// ===============================
// PRODUCT ADD MODAL
// ===============================
if (document.getElementById('newProductBtn')) {
  document.getElementById('newProductBtn').addEventListener('click', async () => {
    await loadCategoriesForAddModal();
    document.getElementById('productAddModal').hidden = false;
    document.getElementById('productAddModal').setAttribute('aria-hidden', 'false');
  });
}

document.getElementById('addModalCloseBtn')?.addEventListener('click', closeAddModal);
document.getElementById('addCancelBtn')?.addEventListener('click', closeAddModal);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAddModal();
});

function closeAddModal() {
  document.getElementById('productAddModal').hidden = true;
  document.getElementById('productAddModal').setAttribute('aria-hidden', 'true');
  document.getElementById('productAddForm').reset();
  document.getElementById('addNewCategoryInput').style.display = 'none';
  document.getElementById('addFormMessage').textContent = '';
}

async function loadCategoriesForAddModal() {
  try {
    const data = await api('/products/all');
    const products = data.products || [];
    
    // Extract unique categories (case-insensitive)
    const categoryMap = new Map();
    products.forEach((product) => {
      const normalized = product.category.toLowerCase().trim();
      if (!categoryMap.has(normalized)) {
        categoryMap.set(normalized, product.category); // Keep original casing
      }
    });
    
    const uniqueCategories = Array.from(categoryMap.values()).sort();
    
    // Populate category dropdown
    const select = document.getElementById('addCategorySelect');
    if (select) {
      // Keep the first two options
      select.innerHTML = '<option value="">Select category...</option><option value="+new">+ New Category</option>';
      
      // Add existing categories
      uniqueCategories.forEach((category) => {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = category;
        select.appendChild(option);
      });
    }
  } catch (error) {
    console.error('Failed to load categories:', error);
  }
}

document.getElementById('addCategorySelect')?.addEventListener('change', (e) => {
  const newCategoryInput = document.getElementById('addNewCategoryInput');
  if (e.target.value === '+new') {
    newCategoryInput.style.display = 'block';
    newCategoryInput.required = true;
    newCategoryInput.focus();
  } else {
    newCategoryInput.style.display = 'none';
    newCategoryInput.required = false;
    newCategoryInput.value = '';
  }
});

document.getElementById('productAddForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msgEl = document.getElementById('addFormMessage');
  msgEl.textContent = '';

  const name = document.getElementById('addName').value.trim();
  const categorySelect = document.getElementById('addCategorySelect').value;
  const newCategoryInput = document.getElementById('addNewCategoryInput').value.trim();
  const price = parseFloat(document.getElementById('addPrice').value);
  const stock = parseInt(document.getElementById('addStock').value, 10);
  const imageRaw = document.getElementById('addImage').value.trim();
  const image = imageRaw || 'assets/product-placeholder.svg';
  const active = document.getElementById('addActive').checked;

  // Determine category
  let category;
  if (categorySelect === '+new') {
    category = newCategoryInput;
  } else {
    category = categorySelect;
  }

  // Client-side validation
  if (!name) { msgEl.textContent = 'Product name is required.'; return; }
  if (!category) { msgEl.textContent = 'Category is required.'; return; }
  if (!Number.isFinite(price) || price < 0) { msgEl.textContent = 'Enter a valid non-negative price.'; return; }
  if (!Number.isInteger(stock) || stock < 0) { msgEl.textContent = 'Stock must be a non-negative whole number.'; return; }

  const saveBtn = document.getElementById('addSaveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Adding…';

  try {
    await api('/products', {
      method: 'POST',
      body: JSON.stringify({ name, category, price, stock, image, active, lowStockThreshold: 5 })
    });
    setMessage(msgEl, 'Product added successfully!', true);
    // Refresh the products table so changes are immediately visible
    await renderProductsTable();
    // Close the modal after a short delay so the admin can see the success message
    setTimeout(closeAddModal, 900);
  } catch (error) {
    msgEl.textContent = error.message || 'Could not add product.';
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Add Product';
  }
});


// ===============================
// ADMIN MANAGEMENT
// ===============================

const addAdminForm = document.getElementById('addAdminForm');
const addAdminMessage = document.getElementById('addAdminMessage');

if (addAdminForm) {
  addAdminForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const name = document.getElementById('newAdminName').value.trim();
    const email = document.getElementById('newAdminEmail').value.trim();
    const password = document.getElementById('newAdminPassword').value;
    const confirmPassword = document.getElementById('newAdminConfirmPassword').value;

    setMessage(addAdminMessage, 'Creating admin...');

    if (!name || !email || !password || !confirmPassword) {
      setMessage(addAdminMessage, 'Please fill in all fields.');
      return;
    }

    if (!EMAIL_PATTERN.test(email)) {
      setMessage(addAdminMessage, 'Enter a valid email address.');
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      setMessage(
        addAdminMessage,
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
      );
      return;
    }

    if (password !== confirmPassword) {
      setMessage(addAdminMessage, 'Passwords do not match.');
      return;
    }

    try {
      const result = await api('/auth/admins', {
        method: 'POST',
        body: JSON.stringify({
          name,
          email,
          password,
          confirmPassword
        })
      });

      setMessage(
        addAdminMessage,
        result.message || 'Admin created successfully.',
        true
      );

      addAdminForm.reset();

      await loadAdmins();
    } catch (error) {
      console.error('Add admin failed:', error);
      setMessage(
        addAdminMessage,
        error.message || 'Could not create admin.'
      );
    }
  });
}


// ===============================
// LOAD EXISTING ADMINS
// ===============================

async function loadAdmins() {
  const table = document.getElementById('adminsTable');
  if (!table) return;

  try {
    const data = await api('/auth/admins');
    const admins = data.admins || [];

    table.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          ${
            admins.map((admin) => `
              <tr>
                <td>${admin.name || '—'}</td>
                <td>${admin.email || '—'}</td>
                <td>${admin.role || 'admin'}</td>
                <td>${dateLabel(admin.createdAt)}</td>
              </tr>
            `).join('')
            || '<tr><td colspan="4">No admins found</td></tr>'
          }
        </tbody>
      </table>
    `;
  } catch (error) {
    console.error('Could not load admins:', error);
    table.innerHTML = `
      <p class="form-message">
        ${error.message || 'Could not load admins.'}
      </p>
    `;
  }
}


// ===============================
// CHANGE PASSWORD
// ===============================

const changePasswordForm = document.getElementById('changePasswordForm');
const changePasswordMessage = document.getElementById('changePasswordMessage');

if (changePasswordForm) {
  changePasswordForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const currentPassword =
      document.getElementById('currentPassword').value;

    const newPassword =
      document.getElementById('newPassword').value;

    const confirmPassword =
      document.getElementById('confirmNewPassword').value;

    setMessage(changePasswordMessage, 'Updating password...');

    if (!currentPassword || !newPassword || !confirmPassword) {
      setMessage(changePasswordMessage, 'Please fill in all fields.');
      return;
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setMessage(
        changePasswordMessage,
        `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage(changePasswordMessage, 'New passwords do not match.');
      return;
    }

    try {
      const result = await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword
        })
      });

      setMessage(
        changePasswordMessage,
        result.message || 'Password updated successfully.',
        true
      );

      changePasswordForm.reset();

      if (result.reauthRequired) {
        setTimeout(() => {
          localStorage.removeItem('sattwikToken');
          token = '';
          window.location.href = '/admin/login.html';
        }, 1500);
      }

    } catch (error) {
      console.error('Change password failed:', error);
      setMessage(
        changePasswordMessage,
        error.message || 'Could not update password.'
      );
    }
  });
}