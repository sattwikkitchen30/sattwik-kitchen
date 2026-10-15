const API_PREFIX = '/api';
let token = localStorage.getItem('sattwikToken') || '';
let state = { overview: null, orders: [], products: [], customers: [], custom: null, ordersFulfillment: 'delivery', ordersRequestId: 0 };
let tiffinEditorOrder = null;
let tiffinEditorItems = [];
let tiffinEditorProducts = [];
let tiffinEditorCatalog = [];
let tiffinEditorAdditionalRows = [];
let tiffinEditorRowSeq = 0;

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
  document.getElementById('ordersCreatedDate')?.addEventListener('change', renderOrdersTable);
  document.getElementById('ordersSearch')?.addEventListener('input', scheduleOrdersSearch);
  document.getElementById('ordersFilterReset')?.addEventListener('click', () => {
    const date = document.getElementById('ordersCreatedDate');
    const search = document.getElementById('ordersSearch');
    if (date) date.value = '';
    if (search) search.value = '';
    renderOrdersTable();
  });
  document.querySelectorAll('[data-fulfillment-tab]').forEach((button) => button.addEventListener('click', async () => {
    state.ordersFulfillment = button.dataset.fulfillmentTab;
    document.querySelectorAll('[data-fulfillment-tab]').forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    const dateLabel = document.getElementById('ordersDateLabel');
    if (dateLabel) dateLabel.textContent = state.ordersFulfillment === 'delivery' ? 'Delivery start date' : 'Pickup date';
    await renderOrdersTable();
  }));
  const dateLabel = document.getElementById('ordersDateLabel');
  if (dateLabel) dateLabel.textContent = state.ordersFulfillment === 'delivery' ? 'Delivery start date' : 'Pickup date';

}

function getLocalDateString(date = new Date()) {
  const value = new Date(date);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Vancouver',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  });
  const parts = formatter.formatToParts(value);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function currency(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
}

function pickupStatusForOrder(order, items) {
  const pickupStatuses = items.filter((item) => item.fulfillment === 'pickup').map((item) => String(item.deliveryStatus || 'PENDING').toUpperCase());
  const rawStatus = pickupStatuses.includes('DELIVERED')
    ? 'DELIVERED'
    : pickupStatuses.includes('CANCELLED')
      ? 'CANCELLED'
      : pickupStatuses[0] || (order.fulfillment === 'pickup' ? String(order.status || 'PENDING').toUpperCase() : 'PENDING');
  if (rawStatus === 'CANCELLED') return 'CANCELLED';
  if (rawStatus === 'DELIVERED') return 'DELIVERED';
  if (rawStatus === 'OUT_FOR_DELIVERY') return rawStatus;
  if (['ACCEPTED', 'CONFIRMED', 'PREPARING', 'READY'].includes(rawStatus)) return 'ACCEPTED';
  return 'PENDING';
}

function pickupStatusLabel(status) {
  return ({ PENDING: 'Pending', ACCEPTED: 'Accepted', OUT_FOR_DELIVERY: 'Out for Delivery', DELIVERED: 'Delivered', CANCELLED: 'Cancelled' })[status] || status;
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

function renderDeliveryStatusOptions(status, includeCancelled = false, canCancel = true) {
  const values = ['PENDING', 'ACCEPTED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
  if (includeCancelled) values.push('CANCELLED');
  return values.map((value) => `<option value="${value}" ${status === value ? 'selected' : ''} ${value === 'CANCELLED' && (!canCancel || ['DELIVERED', 'CANCELLED'].includes(status)) ? 'disabled' : ''}>${deliveryStatusLabel(value)}</option>`).join('');
}

function renderPickupStatusControl(orderId, status, canCancel = true) {
  const values = ['PENDING', 'ACCEPTED', 'DELIVERED', 'CANCELLED'];
  if (!values.includes(status)) values.unshift(status);
  const options = values
    .map((value) => `<option value="${value}" ${value === status ? 'selected' : ''} ${value === 'CANCELLED' && (!canCancel || ['DELIVERED', 'CANCELLED'].includes(status)) ? 'disabled' : ''}>${pickupStatusLabel(value)}</option>`)
    .join('');
  const disabled = ['DELIVERED', 'CANCELLED'].includes(status) ? 'disabled' : '';
  return `<select class="pickup-status-select" data-order-id="${orderId}" data-current-status="${status}" ${disabled}>${options}</select>`;
}

function dateLabel(date) {
  const d = new Date(date);
  if (Number.isNaN(d.valueOf())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Vancouver' });
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
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Vancouver',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric'
      });
      const parts = formatter.formatToParts(value);
      const year = parts.find(p => p.type === 'year')?.value;
      const month = parts.find(p => p.type === 'month')?.value;
      const day = parts.find(p => p.type === 'day')?.value;
      dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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

let ordersSearchTimer;
function scheduleOrdersSearch() {
  clearTimeout(ordersSearchTimer);
  ordersSearchTimer = setTimeout(renderOrdersTable, 250);
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
    await renderOrdersTable();
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
      const dateStr = state.tiffinPreparationDate || getLocalDateString(new Date());
      const date = new Date(`${dateStr}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() - 1);
      loadTiffinPreparation(getLocalDateString(date));
    });
  }

  const nextDayBtn = document.getElementById('prepNextDay');
  if (nextDayBtn) {
    nextDayBtn.addEventListener('click', () => {
      const dateStr = state.tiffinPreparationDate || getLocalDateString(new Date());
      const date = new Date(`${dateStr}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + 1);
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
  const requestId = ++state.ordersRequestId;
  const dateValue = document.getElementById('ordersCreatedDate')?.value || '';
  const searchValue = document.getElementById('ordersSearch')?.value.trim() || '';
  if (dateValue) params.set('orderDate', dateValue);
  if (searchValue) params.set('search', searchValue);
  const filterActive = Boolean(dateValue || searchValue);
  params.set('page', '1');
  params.set('limit', '100');
  const firstPage = await api(`/orders?${params.toString()}`);
  const orders = firstPage.orders || [];
  if (filterActive && firstPage.pages > 1) {
    const remainingPages = [];
    for (let page = 2; page <= firstPage.pages; page += 1) {
      const pageParams = new URLSearchParams(params);
      pageParams.set('page', String(page));
      remainingPages.push(api(`/orders?${pageParams.toString()}`));
    }
    const pages = await Promise.all(remainingPages);
    pages.forEach((result) => orders.push(...(result.orders || [])));
  }
  if (requestId !== state.ordersRequestId) return;
  let deliveryMembers = [];
  if (state.ordersFulfillment === 'delivery') try {
    const deliveryMembersData = await api('/delivery-members');
    deliveryMembers = deliveryMembersData.members || [];
  } catch (error) {
    console.error('Failed to load delivery members:', error);
  }
  if (requestId !== state.ordersRequestId) return;
  const table = document.getElementById('ordersTable');
  const resultCount = document.getElementById('ordersResultCount');
  if (resultCount) resultCount.textContent = `${orders.length} ${orders.length === 1 ? 'order' : 'orders'} found`;
  const headers = state.ordersFulfillment === 'delivery'
    ? ['Order ID', 'Customer Name', 'Contact Details', 'Item', 'Type', 'Start Date', 'End Date', 'Delivery Member', 'Amount', 'Status']
    : ['Order', 'Customer / contact', 'Items', 'Type', 'Fulfillment', 'Date', 'Pickup Date', 'Status', 'Amount'];

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
          const canCancel = !order.firstDeliveredAt && !order.deliveredAt;
          const isTiffinDelivery = order.type === 'tiffin' && items.some((item) => item.fulfillment === 'delivery');

          if (state.ordersFulfillment === 'delivery' && isTiffinDelivery) {
            const deliveryPlanItems = items.filter((item) => item.fulfillment === 'delivery');
            const itemNames = deliveryPlanItems.map((item) => (
              `${escHtml(item.productName || 'Tiffin Plan')} × ${Number(item.quantity) || 0}`
            )).join('<br>');
            const itemDetails = itemNames || (
              order.tiffinPlan?.packageType
                ? `${order.tiffinPlan.packageType === 'curry-only' ? 'Curry-Only' : 'Full Meal'} Package`
                : 'Tiffin Plan'
            );
            const tiffinStatus = String(order.status || 'PENDING').toUpperCase();
            const startDate = order.subscriptionStartDate;
            const endDate = order.subscriptionEndDate || order.createdAt;
            const rowState = getTiffinRowState(startDate, endDate);
            const amountEditor = renderOrderAmountEditor(order);
            return `
              <tr class="${rowState}" data-order-id="${order._id}">
                <td>${escHtml(order.orderId)}</td>
                <td><strong>${escHtml(customerName)}</strong></td>
                <td>${escHtml(customer.phone || '—')}<br>${escHtml(customer.email || '—')}<br><strong>Address:</strong> ${escHtml(order.deliveryAddress || customer.address || customer.area || '—')}</td>
                <td>${itemDetails}<br><button type="button" class="edit-tiffin-items-btn" data-order-id="${order._id}">Add Items</button></td>
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
                <td>${amountEditor}</td>
                <td>
                  <select class="tiffin-status-select order-status-select" data-order-id="${order._id}" data-current-status="${tiffinStatus}" ${['DELIVERED', 'CANCELLED'].includes(tiffinStatus) ? 'disabled' : ''}>
                    ${renderDeliveryStatusOptions(tiffinStatus, true, canCancel)}
                  </select>
                </td>
              </tr>
            `;
          }

          const itemDetails = items.map((it) => `${escHtml(it.productName)} × ${Number(it.quantity) || 0} — ${currency(it.priceAtPurchase)} each; ${currency(it.subtotal)} (${it.fulfillment === 'delivery' ? 'Delivery' : 'Pickup'})`).join('<br>');
          const orderDetails = [itemDetails, order.customRequest ? `Custom request: ${order.customRequest}` : ''].filter(Boolean).join('<br>') || '—';
          const savedLocation = order.deliveryAddress || customer.address || customer.area || '—';
          const deliveryAddress = state.ordersFulfillment === 'delivery'
            ? `<br><strong>Address:</strong> ${escHtml(savedLocation)}`
            : `<br><strong>Location:</strong> ${escHtml(savedLocation)}`;
          const escapedCustomerName = escHtml(customerName);
          const escapedPhone = escHtml(customer.phone || '—');
          const escapedEmail = escHtml(customer.email || '—');
          const orderDateTime = new Date(order.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Vancouver' });
          const deliveryAssignment = state.ordersFulfillment === 'delivery' ? `
            <td><select class="delivery-member-select" data-order-id="${order._id}" data-current-member="${order.deliveryMemberId || ''}">
              <option value="">Unassigned</option>
              ${deliveryMembers.filter((member) => member.active !== false).map((member) => `<option value="${member.id}" ${String(order.deliveryMemberId || '') === String(member.id) ? 'selected' : ''}>${escHtml(member.name)}</option>`).join('')}
            </select></td>` : '';
          return `
          <tr>
            <td>${escHtml(order.orderId)}</td>
            ${state.ordersFulfillment === 'delivery'
              ? `<td><strong>${escapedCustomerName}</strong></td><td>${escapedPhone}<br>${escapedEmail}${deliveryAddress}</td>`
              : `<td><strong>${escapedCustomerName}</strong><br>${escapedPhone}<br>${escapedEmail}${deliveryAddress}</td>`}
            <td>${orderDetails}</td>
            <td>${order.type}</td>
            ${state.ordersFulfillment === 'delivery'
              ? `<td><div class="tiffin-end-date-cell"><input type="date" class="delivery-start-date-input" data-order-id="${order._id}" value="${order.subscriptionStartDate ? getDateInputValue(order.subscriptionStartDate) : ''}" /><button class="delivery-start-date-save" data-order-id="${order._id}">Save</button></div></td><td><div class="tiffin-end-date-cell"><input type="date" class="delivery-end-date-input" data-order-id="${order._id}" value="${order.subscriptionEndDate ? getDateInputValue(order.subscriptionEndDate) : ''}" /><button class="delivery-end-date-save" data-order-id="${order._id}">Save</button></div></td>${deliveryAssignment}<td>${renderOrderAmountEditor(order)}</td>`
              : `<td>Pickup</td><td>${orderDateTime}</td><td><div class="tiffin-end-date-cell pickup-date-editor" data-order-id="${order._id}"><input type="date" class="pickup-date-input" data-order-id="${order._id}" value="${order.pickupDate ? getDateInputValue(order.pickupDate) : ''}" /><button type="button" class="pickup-date-save" data-order-id="${order._id}">Save</button></div></td>`}
            <td>
              ${state.ordersFulfillment === 'delivery' ? `<select class="order-status-select" data-order-id="${order._id}" data-current-status="${order.status}" ${['DELIVERED', 'CANCELLED'].includes(String(order.status).toUpperCase()) ? 'disabled' : ''}>
                ${renderDeliveryStatusOptions(order.status, true, canCancel)}
              </select><span class="badge ${String(order.status).toLowerCase()}">${deliveryStatusLabel(order.status)}</span>` : renderPickupStatusControl(order._id, pickupStatus, canCancel)}
            </td>
            ${state.ordersFulfillment === 'pickup' ? `<td>${renderOrderAmountEditor(order)}</td>` : ''}
          </tr>
        `;
        }).join('') || `<tr><td colspan="${state.ordersFulfillment === 'delivery' ? 10 : 9}">No ${state.ordersFulfillment} orders match the selected filters.</td></tr>`}
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

  table.querySelectorAll('.order-amount-save').forEach((button) => button.addEventListener('click', async () => {
    const input = table.querySelector(`.order-amount-input[data-order-id="${button.dataset.orderId}"]`);
    const amount = Number(input?.value);
    if (!input || input.value.trim() === '' || !Number.isFinite(amount) || amount < 0) {
      showAdminToast('Enter a valid non-negative order amount.');
      return;
    }

    button.disabled = true;
    try {
      await api(`/orders/${button.dataset.orderId}/amount`, {
        method: 'PUT',
        body: JSON.stringify({ amount })
      });
      showAdminToast('Order amount saved successfully.');
      await loadDashboardData();
    } catch (error) {
      showAdminToast(error.message || 'Could not save order amount.');
    } finally {
      button.disabled = false;
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
    if (select.value === 'CANCELLED' && !window.confirm('Are you sure you want to cancel this order?')) {
      select.value = previous;
      return;
    }
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
    if (select.value === 'CANCELLED' && !window.confirm('Are you sure you want to cancel this order?')) {
      select.value = previous;
      return;
    }
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

function renderOrderAmountEditor(order) {
  const amount = Number(order.orderAmount ?? order.totalAmount ?? order.tiffinPlan?.price ?? 0);
  return `
    <div class="order-amount-editor">
      <span>${currency(amount)}</span>
      <input class="order-amount-input" type="number" min="0" step="0.01" value="${amount.toFixed(2)}" data-order-id="${order._id}" aria-label="Order amount" />
      <button type="button" class="order-amount-save" data-order-id="${order._id}">Save</button>
    </div>
  `;
}

const TIFFIN_SIZE_ALIASES = {
  small: 'small',
  '8 oz': 'small',
  '8oz': 'small',
  medium: 'medium',
  '12 oz': 'medium',
  '12oz': 'medium',
  large: 'large',
  big: 'large',
  '16 oz': 'large',
  '16oz': 'large'
};
const TIFFIN_SIZE_LABELS = { small: 'Small', medium: 'Medium', large: 'Large' };
const TIFFIN_ITEM_ORDER = ['dal', 'curry', 'chapati', 'rice', 'curd'];
const TIFFIN_PREP_FROM_ITEM = {
  dal: (size) => `${size}Dal`,
  curry: (size) => `${size}Curry`,
  curd: (size) => (size === 'large' ? 'bigCurd' : size === 'small' ? 'smallCurd' : null),
  chapati: () => 'chapathi',
  rice: () => 'riceBox'
};
const TIFFIN_PREP_TO_ROW = {
  smallDal: { itemKey: 'dal', size: 'small' },
  mediumDal: { itemKey: 'dal', size: 'medium' },
  largeDal: { itemKey: 'dal', size: 'large' },
  smallCurry: { itemKey: 'curry', size: 'small' },
  mediumCurry: { itemKey: 'curry', size: 'medium' },
  largeCurry: { itemKey: 'curry', size: 'large' },
  smallCurd: { itemKey: 'curd', size: 'small' },
  bigCurd: { itemKey: 'curd', size: 'large' },
  chapathi: { itemKey: 'chapati', size: '' },
  riceBox: { itemKey: 'rice', size: '' }
};

const CANONICAL_DELIVERY_ITEM_NAMES = {
  dal: 'Dal',
  curry: 'Curry',
  chapati: 'Chapati',
  rice: 'Rice',
  curd: 'Curd'
};

function normalizeDeliveryItemKey(name) {
  let value = String(name || '').trim().toLowerCase();
  if (!value) return '';
  value = value.replace(/^(small|medium|large|big)\s+/, '');
  if (/\bchapath?i\b|\bchapatti\b/.test(value) || value === 'chapati') return 'chapati';
  if (value === 'dal' || /\bdal\b/.test(value)) return 'dal';
  if (value === 'curry' || /\bcurr(?:y|ies)\b/.test(value)) return 'curry';
  if (value === 'curd' || /\bcurd\b/.test(value)) return 'curd';
  if (value === 'rice' || /\brice\b/.test(value)) return 'rice';
  return value;
}

function parseDeliverySizeToken(quantity) {
  const value = String(quantity || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return TIFFIN_SIZE_ALIASES[value] || '';
}

function collectDeliveryPlanRows(plan) {
  const items = plan?.items || {};
  const rows = [];
  const dynamicItems = Array.isArray(items.dynamicItems) ? items.dynamicItems : [];
  for (const item of dynamicItems) {
    const name = String(item?.name || '').trim();
    if (!name) continue;
    rows.push({ name, quantity: item.quantity });
  }

  if (items.dal) rows.push({ name: 'Dal', quantity: items.dal });
  if (items.curry) rows.push({ name: 'Curry', quantity: items.curry });
  const chapatiCount = items.chapati ?? items.chapathi;
  if (Number(chapatiCount) > 0) rows.push({ name: 'Chapati', quantity: chapatiCount });
  if (Number(items.rice) > 0) rows.push({ name: 'Rice', quantity: items.rice });
  if (items.curd) rows.push({ name: 'Curd', quantity: items.curd });
  return rows;
}

function extractDeliveryCatalogItems(plans = []) {
  const byKey = new Map();
  for (const plan of plans) {
    for (const row of collectDeliveryPlanRows(plan)) {
      const key = normalizeDeliveryItemKey(row.name);
      if (!key) continue;
      const size = parseDeliverySizeToken(row.quantity);
      const displayName = CANONICAL_DELIVERY_ITEM_NAMES[key] || (row.name ? row.name[0].toUpperCase() + row.name.slice(1) : row.name);
      const existing = byKey.get(key) || { key, name: displayName, sizes: [] };
      if (!byKey.has(key)) byKey.set(key, existing);
      if (size && !existing.sizes.includes(size)) existing.sizes.push(size);
    }
  }
  const sizeOrder = ['small', 'medium', 'large'];
  const catalog = [...byKey.values()].map((item) => {
    const sizes = item.key === 'chapati' ? [] : item.sizes.slice().sort((a, b) => sizeOrder.indexOf(a) - sizeOrder.indexOf(b));
    return { key: item.key, name: item.name, sizes, supportsSize: item.key !== 'chapati' && sizes.length > 0 };
  });
  catalog.sort((a, b) => {
    const aIndex = TIFFIN_ITEM_ORDER.indexOf(a.key);
    const bIndex = TIFFIN_ITEM_ORDER.indexOf(b.key);
    if (aIndex !== -1 || bIndex !== -1) return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
    return a.name.localeCompare(b.name);
  });
  return catalog;
}

function getCanonicalIdentity(item) {
  if (!item) return '';
  if (item.productId) return `product:${String(item.productId)}`;

  if (item.preparationType && TIFFIN_PREP_TO_ROW[item.preparationType]) {
    return item.preparationType;
  }

  const name = String(item.productName || '').toLowerCase();
  const size = /\b(big|large)\b/.test(name)
    ? 'large'
    : /\b(medium|med)\b/.test(name)
      ? 'medium'
      : 'small';
  if (/\b(dal)\b/.test(name)) return `${size}Dal`;
  if (/\b(curry|curries)\b/.test(name)) return `${size}Curry`;
  if (/\b(curd)\b/.test(name)) return size === 'large' ? 'bigCurd' : 'smallCurd';
  if (/\b(chapathi|chapati|chapatti)\b/.test(name)) return 'chapathi';
  if (/\b(rice)\b/.test(name)) return 'riceBox';

  const rawKey = normalizeDeliveryItemKey(item.itemKey || item.productName);
  const normalizedSize = parseDeliverySizeToken(item.size) || (item.size ? String(item.size).toLowerCase() : '');

  const prepFactory = TIFFIN_PREP_FROM_ITEM[rawKey];
  if (prepFactory) {
    const resolvedType = normalizedSize ? prepFactory(normalizedSize) : prepFactory();
    if (resolvedType && TIFFIN_PREP_TO_ROW[resolvedType]) {
      return resolvedType;
    }
  }

  return normalizedSize ? `${rawKey}:${normalizedSize}` : rawKey;
}

function createEmptyAddItemRow() {
  return { id: ++tiffinEditorRowSeq, itemKey: '', customName: '', size: '', quantity: '1', isCustom: false };
}

async function openTiffinItemsEditor(orderId) {
  const [orderResponse, deliveryPlansResponse] = await Promise.all([
    api(`/orders/${orderId}`),
    api('/delivery-plans')
  ]);
  const order = orderResponse.order;
  const isDeliveryTiffin = order?.type === 'tiffin'
    && (order.items || []).some((item) => item.fulfillment === 'delivery')
    && !(order.items || []).some((item) => item.fulfillment === 'pickup');
  if (!isDeliveryTiffin) throw new Error('Only delivery tiffin orders can edit preparation items.');

  tiffinEditorOrder = order;
  tiffinEditorCatalog = extractDeliveryCatalogItems(deliveryPlansResponse.plans || []);
  const savedItems = (order.tiffinItems || []).map((item) => ({ ...item }));
  tiffinEditorItems = savedItems.map((item) => {
    const originalQuantity = Number.isInteger(item.originalQuantity) ? item.originalQuantity : (!item.isAdditional ? (Number(item.quantity) || 1) : 0);
    const additionalQuantity = Number.isInteger(item.additionalQuantity) ? item.additionalQuantity : (item.isAdditional ? (Number(item.quantity) || 1) : 0);
    return {
      ...item,
      quantity: Number(item.quantity) || 1,
      originalQuantity,
      additionalQuantity,
      isAdditional: Boolean(item.isAdditional || additionalQuantity > 0)
    };
  });
  tiffinEditorAdditionalRows = [createEmptyAddItemRow()];

  const customer = order.customer || {};
  const customerName = [customer.firstName, customer.lastName].filter(Boolean).join(' ') || '—';
  const planItems = (order.items || []).filter((item) => item.fulfillment === 'delivery');
  const packageSummary = planItems.length
    ? planItems.map((item) => `${item.productName} × ${Number(item.quantity) || 0}`).join(', ')
    : order.tiffinPlan?.packageType
      ? `${order.tiffinPlan.packageType === 'curry-only' ? 'Curry-Only' : 'Full Meal'} Package${order.tiffinPlan.size ? ` — ${order.tiffinPlan.size[0].toUpperCase()}${order.tiffinPlan.size.slice(1)}` : ''}`
      : 'Tiffin Package';
  document.getElementById('tiffinItemsOrderSummary').innerHTML = `
    <div><strong>Order ID:</strong> ${escHtml(order.orderId || '—')}</div>
    <div><strong>Customer:</strong> ${escHtml(customerName)}</div>
    <div><strong>Packages:</strong> ${escHtml(packageSummary)}</div>
    <div><strong>Start Date:</strong> ${escHtml(order.subscriptionStartDate || '—')}</div>
    <div><strong>End Date:</strong> ${escHtml(order.subscriptionEndDate || '—')}</div>
  `;
  document.getElementById('tiffinItemsMessage').textContent = '';
  renderTiffinEditorItems();
  renderTiffinAddItemRows();
  const modal = document.getElementById('tiffinItemsModal');
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
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

function catalogItemForRow(row) {
  return tiffinEditorCatalog.find((item) => item.key === row.itemKey) || null;
}

function renderTiffinAddItemRows() {
  const container = document.getElementById('tiffinAddItemRows');
  if (!container) return;
  container.innerHTML = tiffinEditorAdditionalRows.map((row) => {
    const catalogItem = catalogItemForRow(row);
    const sizeDisabled = !row.isCustom && !catalogItem?.supportsSize;
    const selectedItemOptions = tiffinEditorCatalog.map((item) => (
      `<option value="${escHtml(item.key)}" ${!row.isCustom && item.key === row.itemKey ? 'selected' : ''}>${escHtml(item.name)}</option>`
    )).join('');

    let sizeOptions = '<option value="">—</option>';
    if (row.isCustom) {
      sizeOptions = `
        <option value="">— (No size)</option>
        <option value="small" ${row.size === 'small' ? 'selected' : ''}>Small</option>
        <option value="medium" ${row.size === 'medium' ? 'selected' : ''}>Medium</option>
        <option value="large" ${row.size === 'large' ? 'selected' : ''}>Large</option>
      `;
    } else if (catalogItem?.supportsSize) {
      const validSize = catalogItem.sizes.includes(row.size) ? row.size : '';
      sizeOptions = `<option value="">Select size</option>${catalogItem.sizes.map((s) => (
        `<option value="${s}" ${validSize === s ? 'selected' : ''}>${TIFFIN_SIZE_LABELS[s] || s}</option>`
      )).join('')}`;
    }

    return `
      <div class="tiffin-add-item-row" data-row-id="${row.id}" role="row">
        <label class="tiffin-add-item-select-col">
          <span class="visually-hidden">Select Item</span>
          <select class="tiffin-add-item-select" data-row-id="${row.id}" aria-label="Select item">
            <option value="">Select item</option>
            ${selectedItemOptions}
            <option value="__custom__" ${row.isCustom ? 'selected' : ''}>+ Add</option>
          </select>
          ${row.isCustom ? `
            <input class="tiffin-add-item-custom-name" type="text" data-row-id="${row.id}" placeholder="Custom item name" value="${escHtml(row.customName || '')}" aria-label="Custom item name" style="margin-top:4px;" />
          ` : ''}
        </label>
        <label>
          <span class="visually-hidden">Size</span>
          <select class="tiffin-add-item-size" data-row-id="${row.id}" aria-label="Size" ${sizeDisabled ? 'disabled' : ''}>
            ${sizeOptions}
          </select>
        </label>
        <label>
          <span class="visually-hidden">Quantity</span>
          <input class="tiffin-add-item-quantity" type="number" min="1" step="1" value="${escHtml(row.quantity)}" data-row-id="${row.id}" aria-label="Quantity" />
        </label>
        <div class="tiffin-add-item-actions">
          <button type="button" class="btn btn-secondary btn-sm tiffin-add-item-add" data-row-id="${row.id}">Add</button>
          <button type="button" class="tiffin-item-remove tiffin-add-item-remove" data-row-id="${row.id}">Remove</button>
        </div>
      </div>
    `;
  }).join('');
}

function mergeAddItemRow(rowId) {
  const row = tiffinEditorAdditionalRows.find((r) => r.id === rowId);
  if (!row) return false;
  const message = document.getElementById('tiffinItemsMessage');

  let resolved = null;
  const quantity = Number(row.quantity);
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    message.textContent = 'Quantity must be a positive whole number.';
    return false;
  }

  if (row.isCustom) {
    const rawName = String(row.customName || '').trim();
    if (!rawName || rawName === '+ Add' || rawName === '+Add' || rawName === '__custom__') {
      message.textContent = 'Enter a valid custom item name.';
      return false;
    }
    const size = parseDeliverySizeToken(row.size);
    const sizeLabel = size ? (TIFFIN_SIZE_LABELS[size] || (size[0].toUpperCase() + size.slice(1))) : '';
    const alreadyHasSize = sizeLabel && new RegExp(`^${sizeLabel}\\b`, 'i').test(rawName);
    const productName = sizeLabel && !alreadyHasSize ? `${sizeLabel} ${rawName}` : rawName;
    const key = normalizeDeliveryItemKey(rawName);
    const prepFactory = TIFFIN_PREP_FROM_ITEM[key];
    const prepType = prepFactory ? (size ? prepFactory(size) : prepFactory()) : null;

    resolved = {
      productId: null,
      productName,
      category: 'Tiffin Preparation',
      preparationType: prepType || key,
      itemKey: key,
      size: size || null,
      quantity,
      isAdditional: true
    };
  } else {
    if (!row.itemKey) {
      message.textContent = 'Choose a delivery item from the Delivery catalog.';
      return false;
    }
    const catalogItem = catalogItemForRow(row);
    if (!catalogItem) {
      message.textContent = 'Choose a delivery item from the Delivery catalog.';
      return false;
    }
    const size = catalogItem.supportsSize ? row.size : '';
    if (catalogItem.supportsSize && !catalogItem.sizes.includes(size)) {
      message.textContent = `Choose a valid size for ${catalogItem.name}.`;
      return false;
    }
    const prepFactory = TIFFIN_PREP_FROM_ITEM[catalogItem.key];
    const preparationType = prepFactory
      ? (catalogItem.supportsSize ? prepFactory(size) : prepFactory())
      : catalogItem.key;
    const component = preparationType && TIFFIN_PREP_TO_ROW[preparationType]
      ? {
          smallDal: 'Small Dal',
          mediumDal: 'Medium Dal',
          largeDal: 'Large Dal',
          smallCurry: 'Small Curry',
          mediumCurry: 'Medium Curry',
          largeCurry: 'Large Curry',
          smallCurd: 'Small Curd',
          bigCurd: 'Big Curd',
          chapathi: 'Chapathi',
          riceBox: 'Rice Box'
        }[preparationType]
      : null;
    const productName = component || (catalogItem.supportsSize && size ? `${TIFFIN_SIZE_LABELS[size] || size} ${catalogItem.name}` : catalogItem.name);

    resolved = {
      productId: null,
      productName,
      category: 'Tiffin Preparation',
      preparationType: preparationType || undefined,
      itemKey: catalogItem.key,
      size: size || null,
      quantity,
      isAdditional: true
    };
  }

  const identity = getCanonicalIdentity(resolved);
  const existing = tiffinEditorItems.find((item) => getCanonicalIdentity(item) === identity);
  if (existing) {
    existing.quantity = Number(existing.quantity) + quantity;
    existing.additionalQuantity = (Number(existing.additionalQuantity) || 0) + quantity;
    existing.isAdditional = true;
  } else {
    tiffinEditorItems.push({
      ...resolved,
      originalQuantity: 0,
      additionalQuantity: quantity
    });
  }

  row.itemKey = '';
  row.customName = '';
  row.size = '';
  row.quantity = '1';
  row.isCustom = false;
  message.textContent = '';
  renderTiffinEditorItems();
  renderTiffinAddItemRows();
  return true;
}

function closeTiffinItemsEditor() {
  const modal = document.getElementById('tiffinItemsModal');
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  tiffinEditorOrder = null;
  tiffinEditorItems = [];
  tiffinEditorCatalog = [];
  tiffinEditorAdditionalRows = [];
}

document.getElementById('tiffinItemsCloseBtn')?.addEventListener('click', closeTiffinItemsEditor);
document.getElementById('tiffinItemsCancelBtn')?.addEventListener('click', closeTiffinItemsEditor);
document.getElementById('tiffinItemsModal')?.addEventListener('click', (event) => {
  if (event.target === event.currentTarget) closeTiffinItemsEditor();
});

document.getElementById('tiffinAddAnotherItemBtn')?.addEventListener('click', () => {
  tiffinEditorAdditionalRows.push(createEmptyAddItemRow());
  renderTiffinAddItemRows();
});

document.getElementById('tiffinAddItemRows')?.addEventListener('click', (event) => {
  const removeButton = event.target.closest('.tiffin-add-item-remove');
  const addButton = event.target.closest('.tiffin-add-item-add');
  if (removeButton) {
    const rowId = Number(removeButton.dataset.rowId);
    tiffinEditorAdditionalRows = tiffinEditorAdditionalRows.filter((row) => row.id !== rowId);
    if (!tiffinEditorAdditionalRows.length) tiffinEditorAdditionalRows = [createEmptyAddItemRow()];
    renderTiffinAddItemRows();
    return;
  }
  if (addButton) {
    const rowId = Number(addButton.dataset.rowId);
    mergeAddItemRow(rowId);
  }
});

document.getElementById('tiffinAddItemRows')?.addEventListener('change', (event) => {
  const rowId = Number(event.target.dataset.rowId);
  const row = tiffinEditorAdditionalRows.find((entry) => entry.id === rowId);
  if (!row) return;
  if (event.target.matches('.tiffin-add-item-select')) {
    if (event.target.value === '__custom__') {
      row.itemKey = '__custom__';
      row.isCustom = true;
      row.size = '';
    } else {
      row.itemKey = event.target.value;
      row.isCustom = false;
      row.customName = '';
      const catalogItem = catalogItemForRow(row);
      row.size = catalogItem?.supportsSize && catalogItem.sizes.includes(row.size) ? row.size : '';
    }
    renderTiffinAddItemRows();
    return;
  }
  if (event.target.matches('.tiffin-add-item-size')) {
    row.size = event.target.value;
    return;
  }
  if (event.target.matches('.tiffin-add-item-quantity')) {
    row.quantity = event.target.value;
    const quantity = Number(event.target.value);
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      document.getElementById('tiffinItemsMessage').textContent = 'Quantity must be a positive whole number.';
    } else {
      document.getElementById('tiffinItemsMessage').textContent = '';
    }
  }
});

document.getElementById('tiffinAddItemRows')?.addEventListener('input', (event) => {
  const rowId = Number(event.target.dataset.rowId);
  const row = tiffinEditorAdditionalRows.find((entry) => entry.id === rowId);
  if (!row) return;
  if (event.target.matches('.tiffin-add-item-custom-name')) {
    row.customName = event.target.value;
    return;
  }
  if (event.target.matches('.tiffin-add-item-quantity')) {
    row.quantity = event.target.value;
    const quantity = Number(event.target.value);
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      document.getElementById('tiffinItemsMessage').textContent = 'Quantity must be a positive whole number.';
    } else {
      document.getElementById('tiffinItemsMessage').textContent = '';
    }
  }
});

document.getElementById('tiffinItemsList')?.addEventListener('click', (event) => {
  const stepButton = event.target.closest('.tiffin-item-step');
  const removeButton = event.target.closest('.tiffin-item-remove');
  if (!stepButton && !removeButton) return;
  const index = Number((stepButton || removeButton).dataset.itemIndex);
  if (!Number.isInteger(index) || !tiffinEditorItems[index]) return;
  const item = tiffinEditorItems[index];
  if (removeButton) {
    if (item.originalQuantity > 0 && item.additionalQuantity > 0) {
      item.quantity = item.originalQuantity;
      item.additionalQuantity = 0;
      item.isAdditional = false;
    } else {
      tiffinEditorItems.splice(index, 1);
    }
  } else {
    const nextQuantity = Number(item.quantity) + Number(stepButton.dataset.step);
    const validQty = Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, nextQuantity));
    item.quantity = validQty;
    if (item.originalQuantity > 0) {
      item.additionalQuantity = Math.max(0, validQty - item.originalQuantity);
      item.isAdditional = item.additionalQuantity > 0;
    } else {
      item.additionalQuantity = validQty;
      item.isAdditional = true;
    }
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
  const item = tiffinEditorItems[index];
  item.quantity = quantity;
  if (item.originalQuantity > 0) {
    item.additionalQuantity = Math.max(0, quantity - item.originalQuantity);
    item.isAdditional = item.additionalQuantity > 0;
  } else {
    item.additionalQuantity = quantity;
    item.isAdditional = true;
  }
  document.getElementById('tiffinItemsMessage').textContent = '';
});

document.getElementById('tiffinItemsSaveBtn')?.addEventListener('click', async (event) => {
  if (!tiffinEditorOrder) return;
  const button = event.currentTarget;
  const message = document.getElementById('tiffinItemsMessage');

  for (const row of tiffinEditorAdditionalRows) {
    const hasInput = row.isCustom ? row.customName.trim() : row.itemKey;
    if (hasInput) {
      const ok = mergeAddItemRow(row.id);
      if (!ok) return;
    }
  }

  for (const item of tiffinEditorItems) {
    if (!Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) < 1) {
      message.textContent = 'Quantity must be a positive whole number.';
      return;
    }
  }

  if (tiffinEditorItems.length > 50) {
    message.textContent = 'An order can contain at most 50 preparation items.';
    return;
  }

  const items = tiffinEditorItems.map((item) => ({
    productId: item.productId && /^[a-fA-F0-9]{24}$/.test(String(item.productId)) ? item.productId : null,
    preparationType: item.preparationType || null,
    productName: item.productName,
    category: item.category || 'Tiffin Preparation',
    itemKey: item.itemKey || null,
    size: item.size || null,
    quantity: Number(item.quantity),
    originalQuantity: Number(item.originalQuantity) || 0,
    additionalQuantity: Number(item.additionalQuantity) || 0,
    isAdditional: Boolean(item.isAdditional || (item.additionalQuantity > 0))
  }));

  button.disabled = true;
  message.textContent = '';
  try {
    await api(`/orders/${tiffinEditorOrder._id}/tiffin-items`, {
      method: 'PUT',
      body: JSON.stringify({ items })
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

function displayProductCategory(category) {
  const value = String(category || '').trim();
  return /^tiffin$/i.test(value) || /^breakfast$/i.test(value) ? 'Breakfast' : value;
}

async function renderProductsTable() {
  const data = await api('/products/all');
  const products = data.products || [];

  // Populate the categories datalist in the edit modal with all unique categories
  // so the admin gets autocomplete suggestions when editing.
  const datalist = document.getElementById('existingCategoriesList');
  if (datalist) {
    const cats = [...new Set(products.map((p) => displayProductCategory(p.category)).filter(Boolean))].sort();
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
            <td>${escHtml(displayProductCategory(product.category))}</td>
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
        <th>Name</th><th>Email</th><th>Phone</th><th>Active</th><th>Created</th><th>Actions</th>
      </tr></thead>
      <tbody>
        ${members.map((member) => `
          <tr>
            <td>${escHtml(member.name)}</td>
            <td>${escHtml(member.email)}</td>
            <td>${escHtml(member.phone)}</td>
            <td>${member.active ? 'Yes' : 'No'}</td>
            <td>${dateLabel(member.createdAt)}</td>
            <td>
              <button class="table-action-btn view-details-btn" data-member-id="${member.id}">View Details</button>
            </td>
          </tr>
        `).join('') || '<tr><td colspan="6">No delivery members found</td></tr>'}
      </tbody>
    </table>
  `;
  
  // Add click handlers for View Details buttons
  table.querySelectorAll('.view-details-btn').forEach((btn) => {
    btn.addEventListener('click', () => openMemberDetailsModal(btn.dataset.memberId));
  });
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
// Delivery member details modal logic
// -----------------------------------------------------------------------

let currentMemberId = null;
let memberHistoryPage = 0;
const memberHistoryPageSize = 50;

async function openMemberDetailsModal(memberId) {
  currentMemberId = memberId;
  memberHistoryPage = 0;
  
  try {
    const data = await api(`/delivery-members/${encodeURIComponent(memberId)}`);
    const member = data.member;
    
    // Populate member info
    document.getElementById('memberDetailName').textContent = member.name;
    document.getElementById('memberDetailEmail').textContent = member.email;
    document.getElementById('memberDetailPhone').textContent = member.phone;
    document.getElementById('memberDetailStatus').textContent = member.active ? 'Active' : 'Inactive';
    document.getElementById('memberDetailTotalCount').textContent = data.totalCount || 0;
    
    // Set current month as default for month filter
    const now = new Date();
    document.getElementById('memberMonthFilter').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    
    // Load initial history (all time)
    await loadMemberHistory(memberId);
    
    // Show modal
    document.getElementById('memberDetailsModal').hidden = false;
    document.getElementById('memberDetailsModal').setAttribute('aria-hidden', 'false');
  } catch (error) {
    alert(error.message || 'Could not load member details');
  }
}

function closeMemberDetailsModal() {
  document.getElementById('memberDetailsModal').hidden = true;
  document.getElementById('memberDetailsModal').setAttribute('aria-hidden', 'true');
  currentMemberId = null;
  memberHistoryPage = 0;
  document.getElementById('memberFilterMessage').textContent = '';
}

async function loadMemberHistory(memberId, filters = {}) {
  try {
    const { period, month, fromDate, toDate } = filters;
    const queryParams = {};
    
    if (period === 'month' && month) {
      const [year, monthNum] = month.split('-');
      queryParams.year = parseInt(year);
      queryParams.month = parseInt(monthNum);
    } else if (period === 'custom') {
      if (fromDate) queryParams.fromDate = fromDate;
      if (toDate) queryParams.toDate = toDate;
    }
    
    queryParams.skip = memberHistoryPage * memberHistoryPageSize;
    queryParams.limit = memberHistoryPageSize;
    
    const data = await api(`/delivery-members/${encodeURIComponent(memberId)}?${new URLSearchParams(queryParams)}`);
    
    // Update filtered count
    document.getElementById('memberFilteredCount').textContent = data.periodCount || 0;
    
    // Render history table
    renderMemberHistoryTable(data.history);
    
    // Update pagination
    const historyTotal = data.historyTotal || 0;
    const totalPages = Math.ceil(historyTotal / memberHistoryPageSize);
    document.getElementById('memberHistoryPagination').hidden = totalPages <= 1;
    document.getElementById('memberHistoryPageInfo').textContent = `Page ${memberHistoryPage + 1} of ${totalPages || 1}`;
    document.getElementById('memberHistoryPrev').disabled = memberHistoryPage === 0;
    document.getElementById('memberHistoryNext').disabled = memberHistoryPage >= totalPages - 1;
    
  } catch (error) {
    console.error('Failed to load member history:', error);
    document.getElementById('memberHistoryTable').innerHTML = '<p>Could not load delivery history</p>';
  }
}

function renderMemberHistoryTable(history) {
  const table = document.getElementById('memberHistoryTable');
  
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
              <td>${escHtml(record.orderId)}</td>
              <td>${escHtml(`${customer.firstName || ''} ${customer.lastName || ''}`.trim())}</td>
              <td>${escHtml(customer.phone || '')}</td>
              <td>${escHtml(itemDisplay)}</td>
              <td>$${(record.orderAmount || 0).toFixed(2)}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

// Filter controls
document.getElementById('memberPeriodFilter')?.addEventListener('change', (e) => {
  const period = e.target.value;
  const monthLabel = document.getElementById('monthFilterLabel');
  const customLabel = document.getElementById('customDateFilterLabel');
  const customLabel2 = document.getElementById('customDateFilterLabel2');
  
  monthLabel.hidden = period !== 'month';
  customLabel.hidden = period !== 'custom';
  customLabel2.hidden = period !== 'custom';
  
  if (period === 'all') {
    loadMemberHistory(currentMemberId, { period: 'all' });
  }
});

document.getElementById('memberApplyFilter')?.addEventListener('click', () => {
  const period = document.getElementById('memberPeriodFilter').value;
  const month = document.getElementById('memberMonthFilter').value;
  const fromDate = document.getElementById('memberFromDate').value;
  const toDate = document.getElementById('memberToDate').value;
  const msgEl = document.getElementById('memberFilterMessage');
  
  msgEl.textContent = '';
  
  if (period === 'custom' && fromDate && toDate && new Date(fromDate) > new Date(toDate)) {
    msgEl.textContent = 'From date must be before or equal to To date.';
    return;
  }
  
  loadMemberHistory(currentMemberId, { period, month, fromDate, toDate });
});

document.getElementById('memberClearFilter')?.addEventListener('click', () => {
  document.getElementById('memberPeriodFilter').value = 'all';
  document.getElementById('monthFilterLabel').hidden = true;
  document.getElementById('customDateFilterLabel').hidden = true;
  document.getElementById('customDateFilterLabel2').hidden = true;
  document.getElementById('memberFromDate').value = '';
  document.getElementById('memberToDate').value = '';
  document.getElementById('memberFilterMessage').textContent = '';
  memberHistoryPage = 0;
  loadMemberHistory(currentMemberId, { period: 'all' });
});

// Pagination
document.getElementById('memberHistoryPrev')?.addEventListener('click', () => {
  if (memberHistoryPage > 0) {
    memberHistoryPage--;
    loadMemberHistory(currentMemberId);
  }
});

document.getElementById('memberHistoryNext')?.addEventListener('click', () => {
  memberHistoryPage++;
  loadMemberHistory(currentMemberId);
});

// Delete member
document.getElementById('memberDeleteBtn')?.addEventListener('click', () => {
  const memberName = document.getElementById('memberDetailName').textContent;
  const message = document.getElementById('deleteMemberMessage');
  
  message.textContent = `Are you sure you want to delete ${memberName}? This action is permanent and will remove their account and all related delivery history. Their past deliveries will no longer appear in reports.`;
  
  document.getElementById('deleteMemberModal').hidden = false;
  document.getElementById('deleteMemberModal').setAttribute('aria-hidden', 'false');
});

document.getElementById('cancelDeleteMemberBtn')?.addEventListener('click', () => {
  document.getElementById('deleteMemberModal').hidden = true;
  document.getElementById('deleteMemberModal').setAttribute('aria-hidden', 'true');
});

document.getElementById('deleteMemberCloseBtn')?.addEventListener('click', () => {
  document.getElementById('deleteMemberModal').hidden = true;
  document.getElementById('deleteMemberModal').setAttribute('aria-hidden', 'true');
});

document.getElementById('confirmDeleteMemberBtn')?.addEventListener('click', async () => {
  if (!currentMemberId) return;
  
  try {
    await api(`/delivery-members/${encodeURIComponent(currentMemberId)}`, { method: 'DELETE' });
    alert('Delivery member deleted successfully');
    closeMemberDetailsModal();
    document.getElementById('deleteMemberModal').hidden = true;
    document.getElementById('deleteMemberModal').setAttribute('aria-hidden', 'true');
    await renderDeliveryMembersTable();
  } catch (error) {
    alert(error.message || 'Could not delete delivery member');
  }
});

// Close modals
document.getElementById('memberDetailsCloseBtn')?.addEventListener('click', closeMemberDetailsModal);
document.getElementById('memberDetailsCloseBtn')?.addEventListener('click', closeMemberDetailsModal);
document.getElementById('memberDetailsModal')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeMemberDetailsModal();
});

// -----------------------------------------------------------------------
// Product edit modal logic
// -----------------------------------------------------------------------

function openEditModal(product) {
  document.getElementById('editProductId').value = product._id;
  document.getElementById('editName').value = product.name || '';
  document.getElementById('editPrice').value = product.price ?? '';
  document.getElementById('editStock').value = product.stock ?? 0;
  document.getElementById('editDescription').value = product.description || '';
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
    const categoryMap = new Map([['breakfast', 'Breakfast']]);
    products.forEach((product) => {
      const category = displayProductCategory(product.category);
      const normalized = category.toLowerCase();
      if (!categoryMap.has(normalized)) {
        categoryMap.set(normalized, category);
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
        if (category === displayProductCategory(currentCategory)) {
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
  const description = document.getElementById('editDescription').value.trim();
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
  category = displayProductCategory(category);

  // Client-side validation
  if (!name) { msgEl.textContent = 'Product name is required.'; return; }
  if (!category) { msgEl.textContent = 'Category is required.'; return; }
  if (!description) { msgEl.textContent = 'Description is required.'; return; }
  if (!Number.isFinite(price) || price < 0) { msgEl.textContent = 'Enter a valid non-negative price.'; return; }
  if (!Number.isInteger(stock) || stock < 0) { msgEl.textContent = 'Stock must be a non-negative whole number.'; return; }

  const saveBtn = document.getElementById('editSaveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  try {
    await api(`/products/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name, category, price, stock, description, image, active })
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
if (document.getElementById('newPickupProductBtn')) {
  document.getElementById('newPickupProductBtn').addEventListener('click', async () => {
    await loadCategoriesForAddModal();
    document.getElementById('productAddModal').hidden = false;
    document.getElementById('productAddModal').setAttribute('aria-hidden', 'false');
  });
}

// ===============================
// PRODUCT TYPE TAB SWITCHING
// ===============================
const productTypeBtns = document.querySelectorAll('.product-type-btn');
productTypeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const productType = btn.dataset.productType;

    console.log('[Product Type] Switching to:', productType);

    // Update active state
    productTypeBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Switch sections
    const pickupSection = document.getElementById('pickupProductsSection');
    const deliverySection = document.getElementById('deliveryProductsSection');

    console.log('[Product Type] Pickup section:', pickupSection);
    console.log('[Product Type] Delivery section:', deliverySection);

    if (productType === 'pickup') {
      pickupSection.classList.add('active');
      deliverySection.classList.remove('active');
    } else if (productType === 'delivery') {
      pickupSection.classList.remove('active');
      deliverySection.classList.add('active');
      console.log('[Product Type] Loading delivery plans...');
      loadDeliveryPlans();
    }
  });
});

// ===============================
// DELIVERY PLANS
// ===============================
async function loadDeliveryPlans() {
  try {
    console.log('[Delivery Plans] Loading plans...');
    const data = await api('/delivery-plans');
    console.log('[Delivery Plans] Received data:', data);
    renderDeliveryPlans(data.plans);
  } catch (error) {
    console.error('[Delivery Plans] Failed to load delivery plans:', error);
    document.getElementById('deliveryPlansContent').innerHTML = `<p class="error">Could not load delivery plans: ${error.message}</p>`;
  }
}

function renderDeliveryPlans(plans) {
  const container = document.getElementById('deliveryPlansContent');
  if (!container) return;
  
  if (!plans || plans.length === 0) {
    container.innerHTML = '<p>No delivery plans found. Click "Add Delivery Plan" to create one.</p>';
    return;
  }
  
  // Group by category
  const categories = {};
  plans.forEach(plan => {
    if (!categories[plan.category]) {
      categories[plan.category] = {
        description: plan.categoryDescription,
        plans: []
      };
    }
    categories[plan.category].plans.push(plan);
  });
  
  let html = '';
  for (const [categoryName, categoryData] of Object.entries(categories)) {
    html += `
      <div class="delivery-category">
        <h4>${categoryName}</h4>
        ${categoryData.description ? `<p class="category-description">${categoryData.description}</p>` : ''}
        <div class="delivery-plans-list">
    `;
    
    categoryData.plans.forEach(plan => {
      const statusClass = plan.active ? 'active' : 'inactive';
      
      // Handle both old fixed items and new dynamic items
      let itemsHtml = '';
      const sizeToOz = { small: '8 oz', medium: '12 oz', large: '16 oz' };
      if (plan.items && plan.items.dynamicItems && plan.items.dynamicItems.length > 0) {
        // New dynamic items structure
        plan.items.dynamicItems.forEach(item => {
          // Convert quantity names to ounces if they match size names
          let quantity = item.quantity;
          if (sizeToOz[quantity]) {
            quantity = sizeToOz[quantity];
          }
          itemsHtml += `<small>${item.name}: ${quantity}</small>`;
        });
      } else if (plan.items) {
        // Old fixed structure (backward compatibility)
        if (plan.items.dal) itemsHtml += `<small>Dal: ${sizeToOz[plan.items.dal] || plan.items.dal}</small>`;
        if (plan.items.curry) itemsHtml += `<small>Curry: ${sizeToOz[plan.items.curry] || plan.items.curry}</small>`;
        if (plan.items.chapati > 0) itemsHtml += `<small>Chapathi: ${plan.items.chapati}</small>`;
        if (plan.items.rice > 0) itemsHtml += `<small>Rice: ${plan.items.rice}</small>`;
        if (plan.items.curd) itemsHtml += `<small>Curd: ${plan.items.curd}</small>`;
      }
      
      html += `
        <div class="delivery-plan-card ${statusClass}">
          <div class="plan-header">
            <strong>${plan.displayName}</strong>
            <span class="plan-price">$${plan.price.toFixed(2)}</span>
          </div>
          <p class="plan-description">${plan.description || 'No description'}</p>
          <div class="plan-items">
            ${itemsHtml || '<small>No items specified</small>'}
          </div>
          <div class="plan-actions">
            <button class="btn btn-sm btn-secondary" id="edit-btn-${plan._id}" onclick="editDeliveryPlan('${plan._id}', 'edit-btn-${plan._id}')">Edit</button>
            <button class="btn btn-sm btn-danger" id="delete-btn-${plan._id}" onclick="confirmDeleteDeliveryPlan('${plan._id}', '${plan.displayName.replace(/'/g, "\\'")}', 'delete-btn-${plan._id}')">Delete</button>
          </div>
        </div>
      `;
    });
    
    html += `
        </div>
      </div>
    `;
  }
  
  container.innerHTML = html;
}

// ===============================
// DELIVERY PLAN ADD MODAL
// ===============================
document.getElementById('deliveryPlanAddModalCloseBtn')?.addEventListener('click', closeDeliveryPlanAddModal);
document.getElementById('deliveryPlanAddCancelBtn')?.addEventListener('click', closeDeliveryPlanAddModal);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.getElementById('deliveryPlanAddModal').hidden) {
    closeDeliveryPlanAddModal();
  }
});

// Show/hide new category fields based on selection
document.getElementById('deliveryPlanCategory')?.addEventListener('change', (e) => {
  const isNewCategory = e.target.value === '__new__';
  document.getElementById('newCategoryLabel').style.display = isNewCategory ? 'block' : 'none';
  document.getElementById('categoryDescriptionLabel').style.display = isNewCategory ? 'block' : 'none';
  
  if (isNewCategory) {
    document.getElementById('deliveryPlanNewCategory').required = true;
  } else {
    document.getElementById('deliveryPlanNewCategory').required = false;
  }
});

// Show/hide new size field based on selection
document.getElementById('deliveryPlanSize')?.addEventListener('change', (e) => {
  const isNewSize = e.target.value === '__new__';
  document.getElementById('newSizeLabel').style.display = isNewSize ? 'block' : 'none';
  
  if (isNewSize) {
    document.getElementById('deliveryPlanNewSize').required = true;
  } else {
    document.getElementById('deliveryPlanNewSize').required = false;
  }
});

// Dynamic items management
let deliveryPlanItems = [];

function addDeliveryPlanItemRow(item = { name: '', quantity: '' }) {
  const container = document.getElementById('deliveryPlanItemsContainer');
  const row = document.createElement('div');
  row.className = 'delivery-plan-item-row';
  row.style.display = 'flex';
  row.style.gap = '8px';
  row.style.marginBottom = '8px';
  row.style.alignItems = 'center';
  
  row.innerHTML = `
    <input type="text" class="delivery-plan-item-name" placeholder="Item name (e.g., Dal)" value="${item.name}" style="flex: 1; padding: 8px; border: 1px solid var(--border); border-radius: 6px;" required />
    <input type="text" class="delivery-plan-item-quantity" placeholder="Quantity (e.g., 8 oz)" value="${item.quantity}" style="flex: 1; padding: 8px; border: 1px solid var(--border); border-radius: 6px;" required />
    <button type="button" class="btn btn-secondary delivery-plan-item-remove" style="padding: 8px 12px; font-size: 12px;">Remove</button>
  `;
  
  container.appendChild(row);
  
  // Add remove button handler
  row.querySelector('.delivery-plan-item-remove').addEventListener('click', () => {
    row.remove();
  });
}

document.getElementById('deliveryPlanAddItemBtn')?.addEventListener('click', () => {
  addDeliveryPlanItemRow();
});

// Add initial item row when modal opens
if (document.getElementById('newDeliveryPlanBtn')) {
  document.getElementById('newDeliveryPlanBtn').addEventListener('click', (e) => {
    openDeliveryPlanModal(null, e.target.id);
  });
}

// Edit delivery plan
window.editDeliveryPlan = async function(planId, buttonId) {
  try {
    console.log('[Delivery Plans] Loading plan for edit:', planId);
    const data = await api(`/delivery-plans/${planId}`);
    openDeliveryPlanModal(data.plan, buttonId);
  } catch (error) {
    console.error('[Delivery Plans] Failed to load plan for edit:', error);
    alert('Failed to load plan: ' + error.message);
  }
};

// Confirm delete delivery plan
window.confirmDeleteDeliveryPlan = function(planId, planName, buttonId) {
  const modal = document.getElementById('deletePlanConfirmModal');
  const planNameEl = document.getElementById('deletePlanName');
  const deleteBtn = document.getElementById('deletePlanConfirmBtn');
  
  planNameEl.textContent = planName;
  deleteBtn.dataset.planId = planId;
  deleteBtn.dataset.buttonId = buttonId;
  
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  
  // Store opener for focus restoration
  modal.dataset.opener = buttonId;
  
  // Focus delete button
  setTimeout(() => deleteBtn.focus(), 100);
};

function openDeliveryPlanModal(plan = null, openerId = null) {
  const modal = document.getElementById('deliveryPlanAddModal');
  const form = document.getElementById('deliveryPlanAddForm');
  
  // Store the opener ID for focus restoration
  if (openerId) {
    modal.dataset.opener = openerId;
  }
  
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  
  // Clear and reset form
  form.reset();
  document.getElementById('deliveryPlanItemsContainer').innerHTML = '';
  document.getElementById('newCategoryLabel').style.display = 'none';
  document.getElementById('categoryDescriptionLabel').style.display = 'none';
  document.getElementById('newSizeLabel').style.display = 'none';
  document.getElementById('deliveryPlanAddFormMessage').textContent = '';
  document.getElementById('deliveryPlanAddFormMessage').className = 'form-message';
  
  // Move focus into the modal
  setTimeout(() => {
    document.getElementById('deliveryPlanCategory')?.focus();
  }, 100);
  
  // Change save button text if editing
  const saveBtn = document.getElementById('deliveryPlanAddSaveBtn');
  if (plan) {
    saveBtn.textContent = 'Update Delivery Plan';
    saveBtn.dataset.mode = 'edit';
    saveBtn.dataset.planId = plan._id;
    
    // Populate form with existing data
    document.getElementById('deliveryPlanCategory').value = plan.category || '';
    document.getElementById('deliveryPlanSize').value = plan.size || '';
    document.getElementById('deliveryPlanDisplayName').value = plan.displayName || '';
    document.getElementById('deliveryPlanDescription').value = plan.description || '';
    document.getElementById('deliveryPlanPrice').value = plan.price || '';
    
    // Populate dynamic items
    if (plan.items && plan.items.dynamicItems && plan.items.dynamicItems.length > 0) {
      plan.items.dynamicItems.forEach(item => {
        addDeliveryPlanItemRow(item);
      });
    } else {
      // For old fixed structure, convert to dynamic items
      if (plan.items) {
        if (plan.items.dal) addDeliveryPlanItemRow({ name: 'Dal', quantity: plan.items.dal });
        if (plan.items.curry) addDeliveryPlanItemRow({ name: 'Curry', quantity: plan.items.curry });
        if (plan.items.chapati > 0) addDeliveryPlanItemRow({ name: 'Chapathi', quantity: plan.items.chapati });
        if (plan.items.rice > 0) addDeliveryPlanItemRow({ name: 'Rice', quantity: plan.items.rice });
        if (plan.items.curd) addDeliveryPlanItemRow({ name: 'Curd', quantity: plan.items.curd });
      }
    }
  } else {
    saveBtn.textContent = 'Add Delivery Plan';
    saveBtn.dataset.mode = 'add';
    delete saveBtn.dataset.planId;
    
    // Add initial empty item row
    addDeliveryPlanItemRow();
  }
}

// Handle form submission
document.getElementById('deliveryPlanAddForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const saveBtn = document.getElementById('deliveryPlanAddSaveBtn');
  const mode = saveBtn.dataset.mode || 'add';
  const planId = saveBtn.dataset.planId;
  
  const categorySelect = document.getElementById('deliveryPlanCategory').value;
  let category = categorySelect;
  let categoryDescription = '';
  
  // If creating new category
  if (categorySelect === '__new__') {
    category = document.getElementById('deliveryPlanNewCategory').value.trim();
    categoryDescription = document.getElementById('deliveryPlanCategoryDescription').value.trim();
  }
  
  const sizeSelect = document.getElementById('deliveryPlanSize').value;
  let size = sizeSelect;
  
  // If creating new size
  if (sizeSelect === '__new__') {
    size = document.getElementById('deliveryPlanNewSize').value.trim();
  }
  
  const displayName = document.getElementById('deliveryPlanDisplayName').value.trim();
  const description = document.getElementById('deliveryPlanDescription').value.trim();
  const price = parseFloat(document.getElementById('deliveryPlanPrice').value);
  
  // Collect dynamic items
  const itemRows = document.querySelectorAll('.delivery-plan-item-row');
  const dynamicItems = [];
  
  for (const row of itemRows) {
    const name = row.querySelector('.delivery-plan-item-name').value.trim();
    const quantity = row.querySelector('.delivery-plan-item-quantity').value.trim();
    
    if (name && quantity) {
      dynamicItems.push({ name, quantity });
    }
  }
  
  const messageEl = document.getElementById('deliveryPlanAddFormMessage');
  messageEl.textContent = mode === 'edit' ? 'Updating...' : 'Saving...';
  messageEl.className = 'form-message';
  
  try {
    let data;
    if (mode === 'edit') {
      // Update existing plan
      data = await api(`/delivery-plans/${planId}`, {
        method: 'PUT',
        body: JSON.stringify({
          category,
          categoryDescription,
          size,
          displayName,
          description,
          price,
          items: {
            dynamicItems
          }
        })
      });
      messageEl.textContent = 'Delivery plan updated successfully!';
    } else {
      // Create new plan
      data = await api('/delivery-plans', {
        method: 'POST',
        body: JSON.stringify({
          category,
          categoryDescription,
          size,
          displayName,
          description,
          price,
          items: {
            dynamicItems
          }
        })
      });
      messageEl.textContent = 'Delivery plan added successfully!';
    }
    
    messageEl.classList.add('success');
    
    // Refresh delivery plans list
    await loadDeliveryPlans();
    
    // Close modal after a short delay
    setTimeout(() => {
      closeDeliveryPlanAddModal();
    }, 1000);
    
  } catch (error) {
    messageEl.textContent = error.message || (mode === 'edit' ? 'Failed to update delivery plan' : 'Failed to add delivery plan');
    messageEl.classList.add('error');
  }
});

function closeDeliveryPlanAddModal() {
  const modal = document.getElementById('deliveryPlanAddModal');
  const saveBtn = document.getElementById('deliveryPlanAddSaveBtn');
  
  // Move focus away from modal before hiding it to avoid aria-hidden warning
  if (document.activeElement === saveBtn || modal.contains(document.activeElement)) {
    // Try to focus the button that opened the modal, or fallback to main content
    const opener = modal.dataset.opener;
    if (opener && document.getElementById(opener)) {
      document.getElementById(opener).focus();
    } else {
      document.getElementById('newDeliveryPlanBtn')?.focus();
    }
  }
  
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  document.getElementById('deliveryPlanAddForm').reset();
  document.getElementById('newCategoryLabel').style.display = 'none';
  document.getElementById('categoryDescriptionLabel').style.display = 'none';
  document.getElementById('newSizeLabel').style.display = 'none';
  document.getElementById('deliveryPlanItemsContainer').innerHTML = '';
  document.getElementById('deliveryPlanAddFormMessage').textContent = '';
  document.getElementById('deliveryPlanAddFormMessage').className = 'form-message';
}

// Delete plan confirmation modal handlers
document.getElementById('deletePlanCloseBtn')?.addEventListener('click', closeDeletePlanConfirmModal);
document.getElementById('deletePlanCancelBtn')?.addEventListener('click', closeDeletePlanConfirmModal);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.getElementById('deletePlanConfirmModal').hidden) {
    closeDeletePlanConfirmModal();
  }
});

function closeDeletePlanConfirmModal() {
  const modal = document.getElementById('deletePlanConfirmModal');
  const opener = modal.dataset.opener;
  
  if (document.activeElement === document.getElementById('deletePlanConfirmBtn') || modal.contains(document.activeElement)) {
    if (opener && document.getElementById(opener)) {
      document.getElementById(opener).focus();
    }
  }
  
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  document.getElementById('deletePlanMessage').textContent = '';
  document.getElementById('deletePlanMessage').className = 'form-message';
}

document.getElementById('deletePlanConfirmBtn')?.addEventListener('click', async function() {
  const planId = this.dataset.planId;
  const buttonId = this.dataset.buttonId;
  const messageEl = document.getElementById('deletePlanMessage');
  
  this.disabled = true;
  this.textContent = 'Deleting...';
  messageEl.textContent = 'Deleting...';
  messageEl.className = 'form-message';
  
  try {
    await api(`/delivery-plans/${planId}`, { method: 'DELETE' });
    messageEl.textContent = 'Delivery plan deleted successfully!';
    messageEl.classList.add('success');
    
    // Refresh delivery plans list
    await loadDeliveryPlans();
    
    // Close modal after a short delay
    setTimeout(() => {
      closeDeletePlanConfirmModal();
    }, 1000);
  } catch (error) {
    messageEl.textContent = error.message || 'Failed to delete delivery plan';
    messageEl.classList.add('error');
  } finally {
    this.disabled = false;
    this.textContent = 'Delete Plan';
  }
});

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
    const categoryMap = new Map([['breakfast', 'Breakfast']]);
    products.forEach((product) => {
      const category = displayProductCategory(product.category);
      const normalized = category.toLowerCase();
      if (!categoryMap.has(normalized)) {
        categoryMap.set(normalized, category);
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
  const description = document.getElementById('addDescription').value.trim();
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
  category = displayProductCategory(category);

  // Client-side validation
  if (!name) { msgEl.textContent = 'Product name is required.'; return; }
  if (!category) { msgEl.textContent = 'Category is required.'; return; }
  if (!description) { msgEl.textContent = 'Description is required.'; return; }
  if (!Number.isFinite(price) || price < 0) { msgEl.textContent = 'Enter a valid non-negative price.'; return; }
  if (!Number.isInteger(stock) || stock < 0) { msgEl.textContent = 'Stock must be a non-negative whole number.'; return; }

  const saveBtn = document.getElementById('addSaveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Adding…';

  try {
    await api('/products', {
      method: 'POST',
      body: JSON.stringify({ name, category, price, stock, description, image, active, lowStockThreshold: 5 })
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