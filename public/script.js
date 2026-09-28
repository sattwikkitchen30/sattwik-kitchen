const navToggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');
const cart = new Map();
let customRequest = '';

const cartButton = document.getElementById('cartButton');
const cartDrawer = document.getElementById('cartDrawer');
const cartBackdrop = document.getElementById('cartBackdrop');
const cartClose = document.getElementById('cartClose');
const cartItems = document.getElementById('cartItems');
const cartEmpty = document.getElementById('cartEmpty');
const cartTotal = document.getElementById('cartTotal');
const cartCount = document.getElementById('cartCount');
const customCartNote = document.getElementById('customCartNote');
const customerDetailsForm = document.getElementById('customerDetailsForm');
const customerFirstName = document.getElementById('customerFirstName');
const customerLastName = document.getElementById('customerLastName');
const customerPhone = document.getElementById('customerPhone');
const customerEmail = document.getElementById('customerEmail');
const customerArea = document.getElementById('customerArea');
const customerFormStatus = document.getElementById('customerFormStatus');
const sendCartWhatsApp = document.getElementById('sendCartWhatsApp');
const orderToast = document.getElementById('orderToast');
const customerAccountLink = document.getElementById('customerAccountLink');
const customerOrdersLink = document.getElementById('customerOrdersLink');
const customerLogoutBtn = document.getElementById('customerLogoutBtn');
let customerToken = localStorage.getItem('sattwikCustomerToken') || '';
const customOrderAmount = document.getElementById('customOrderAmount');

function persistCart() {
  localStorage.setItem('sattwikCart', JSON.stringify({ items: Array.from(cart.values()), customRequest }));
}

function restoreCart() {
  try {
    const saved = JSON.parse(localStorage.getItem('sattwikCart') || '{}');
    (saved.items || []).forEach((item) => cart.set(item.name, item));
    customRequest = saved.customRequest || '';
  } catch (error) {
    localStorage.removeItem('sattwikCart');
  }
}

restoreCart();

function updateCustomerAuthUI() {
  customerToken = localStorage.getItem('sattwikCustomerToken') || '';
  if (customerToken) {
    customerAccountLink?.classList.add('hidden');
    customerOrdersLink?.classList.remove('hidden');
    customerLogoutBtn?.classList.remove('hidden');
  } else {
    customerAccountLink?.classList.remove('hidden');
    customerOrdersLink?.classList.add('hidden');
    customerLogoutBtn?.classList.add('hidden');
  }
}

async function performCustomerLogout() {
  try {
    if (customerToken) {
      await fetch('/api/customer-auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerToken}` }
      });
    }
  } catch (err) {
    // Local logout completes regardless of network status
  }
  localStorage.removeItem('sattwikCustomerToken');
  localStorage.removeItem('sattwikCustomer');
  // NOTE: do NOT clear shopping cart
  updateCustomerAuthUI();
  window.location.href = '/';
}

customerLogoutBtn?.addEventListener('click', (event) => {
  event.preventDefault();
  performCustomerLogout();
});

updateCustomerAuthUI();

async function loadSignedInCustomer() {
  customerToken = localStorage.getItem('sattwikCustomerToken') || '';
  if (!customerToken) {
    updateCustomerAuthUI();
    return;
  }
  try {
    const response = await fetch('/api/customer-auth/me', { headers: { Authorization: `Bearer ${customerToken}` } });
    if (!response.ok) {
      localStorage.removeItem('sattwikCustomerToken');
      localStorage.removeItem('sattwikCustomer');
      updateCustomerAuthUI();
      return;
    }
    const data = await response.json();
    const customer = data.customer || {};
    if (customerFirstName) customerFirstName.value = customer.firstName || '';
    if (customerLastName) customerLastName.value = customer.lastName || '';
    if (customerPhone) customerPhone.value = customer.phone || '';
    if (customerEmail) customerEmail.value = customer.email || '';
    if (customerArea) customerArea.value = customer.area || '';
    updateCustomerAuthUI();
    updateSendState();
  } catch (error) {
    // Checkout remains usable
  }
}

loadSignedInCustomer();

const money = (value) => `$${Number(value || 0).toFixed(2)}`;

function openCart() {
  cartDrawer?.classList.add('open');
  cartBackdrop?.classList.add('open');
  cartDrawer?.setAttribute('aria-hidden', 'false');
  cartBackdrop?.setAttribute('aria-hidden', 'false');
  cartButton?.setAttribute('aria-expanded', 'true');
  document.body.classList.add('cart-open');
}

function closeCart() {
  cartDrawer?.classList.remove('open');
  cartBackdrop?.classList.remove('open');
  cartDrawer?.setAttribute('aria-hidden', 'true');
  cartBackdrop?.setAttribute('aria-hidden', 'true');
  cartButton?.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('cart-open');
}

function showToast(message) {
  if (!orderToast) return;
  orderToast.textContent = message;
  orderToast.classList.remove('hidden');
  clearTimeout(showToast.timeoutId);
  showToast.timeoutId = setTimeout(() => orderToast.classList.add('hidden'), 2800);
}

cartButton?.addEventListener('click', openCart);
cartClose?.addEventListener('click', closeCart);
cartBackdrop?.addEventListener('click', closeCart);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCart(); });

navToggle?.addEventListener('click', () => {
  const open = navLinks.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
});

document.querySelectorAll('.nav-links a').forEach((link) => link.addEventListener('click', () => {
  navLinks.classList.remove('open');
  navToggle?.setAttribute('aria-expanded', 'false');
}));

const menuTabs = document.querySelectorAll('[data-menu-tab]');
const menuPanels = document.querySelectorAll('[data-menu-panel]');

// Use event delegation on the menu-toggle so dynamically added tab buttons are
// handled automatically — no need to re-bind when new categories appear.
const menuToggleEl = document.querySelector('.menu-toggle');
if (menuToggleEl) {
  menuToggleEl.addEventListener('click', (e) => {
    const button = e.target.closest('[data-menu-tab]');
    if (!button) return;
    const target = button.dataset.menuTab;

    // Update all tab buttons (static + dynamic)
    document.querySelectorAll('[data-menu-tab]').forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    // Update all panels (static + dynamic)
    document.querySelectorAll('[data-menu-panel]').forEach((panel) => {
      panel.classList.toggle('hidden', panel.dataset.menuPanel !== target);
    });
  });
}

function renderProductTiles(products) {
  // Clear all existing product grids
  const picklesGrid = document.getElementById('picklesGrid');
  const powdersGrid = document.getElementById('powdersGrid');
  const tiffinsGrid = document.getElementById('tiffinsGrid');
  const sweetsGrid = document.getElementById('sweetsGrid');
  const snacksGrid = document.getElementById('snacksGrid');
  const dynamicCategories = document.getElementById('dynamicCategories');
  
  if (picklesGrid) picklesGrid.innerHTML = '';
  if (powdersGrid) powdersGrid.innerHTML = '';
  if (tiffinsGrid) tiffinsGrid.innerHTML = '';
  if (sweetsGrid) sweetsGrid.innerHTML = '';
  if (snacksGrid) snacksGrid.innerHTML = '';
  if (dynamicCategories) dynamicCategories.innerHTML = '';

  // Remove existing dynamic panels and their corresponding tab buttons cleanly.
  // Any tab button inside .menu-toggle that doesn't match a known static key is dynamic.
  const STATIC_TABS = new Set(['pickles', 'powders', 'breakfast', 'sweets', 'snacks', 'custom']);
  const menuToggle = document.querySelector('.menu-toggle');
  if (menuToggle) {
    menuToggle.querySelectorAll('[data-menu-tab]').forEach((btn) => {
      if (!STATIC_TABS.has(btn.dataset.menuTab)) btn.remove();
    });
  }

  // Group products by category
  const productsByCategory = {};
  products.forEach((product) => {
    if (!productsByCategory[product.category]) {
      productsByCategory[product.category] = [];
    }
    productsByCategory[product.category].push(product);
  });

  // Define existing category mappings (exact match on the category string stored in DB)
  const existingCategories = {
    'Pickles': { grid: picklesGrid, tab: 'pickles' },
    'Powders': { grid: powdersGrid, tab: 'powders' },
    'Tiffins': { grid: tiffinsGrid, tab: 'breakfast' },
    'Sweets': { grid: sweetsGrid, tab: 'sweets' },
    'Snacks': { grid: snacksGrid, tab: 'snacks' }
  };

  // Render products for each category
  Object.keys(productsByCategory).forEach((category) => {
    const categoryProducts = productsByCategory[category];
    const existing = existingCategories[category];
    
    if (existing && existing.grid) {
      // Render into the existing static grid — never sent to Pickles by mistake
      renderProductsToGrid(categoryProducts, existing.grid);
    } else {
      // Unknown category: create a completely separate section with its own tab
      createDynamicCategorySection(category, categoryProducts);
    }
  });
}

function renderProductsToGrid(products, gridElement) {
  if (!gridElement) return;

  products.forEach((product) => {
    const card = createProductCard(product);
    gridElement.appendChild(card);
  });
}

function createDynamicCategorySection(category, products) {
  const dynamicCategories = document.getElementById('dynamicCategories');
  if (!dynamicCategories) return;

  // Generate a safe, lowercase, hyphenated key for use as data-menu-tab/panel value and DOM ID.
  // Strips anything that isn't a letter, digit, or space, then replaces spaces with hyphens.
  const safeKey = category
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

  // Create panel — hidden by default so it only shows when its tab is clicked
  const section = document.createElement('div');
  section.className = 'menu-tab-panel hidden';
  section.dataset.menuPanel = safeKey;
  section.id = `${safeKey}Menu`;
  section.setAttribute('role', 'tabpanel');

  // Create category heading
  const heading = document.createElement('div');
  heading.className = 'menu-category-heading';
  heading.innerHTML = `
    <span class="pill">New</span>
    <h3>${category.toUpperCase()}</h3>
    <p>Fresh items prepared with care.</p>
  `;

  // Create product grid
  const grid = document.createElement('div');
  grid.className = 'product-grid';
  grid.id = `${safeKey}Grid`;

  // Render products into grid
  products.forEach((product) => {
    const card = createProductCard(product);
    grid.appendChild(card);
  });

  section.appendChild(heading);
  section.appendChild(grid);
  dynamicCategories.appendChild(section);

  // Create tab button — insert before the Custom Order button
  const menuToggle = document.querySelector('.menu-toggle');
  if (menuToggle) {
    const tabButton = document.createElement('button');
    tabButton.type = 'button';
    tabButton.setAttribute('role', 'tab');
    tabButton.setAttribute('aria-selected', 'false');
    tabButton.dataset.menuTab = safeKey;
    tabButton.textContent = category;
    // Clicking is handled by the delegated listener on .menu-toggle (set up above).

    const customButton = menuToggle.querySelector('[data-menu-tab="custom"]');
    if (customButton) {
      menuToggle.insertBefore(tabButton, customButton);
    } else {
      menuToggle.appendChild(tabButton);
    }
  }
}

function createProductCard(product) {
  const card = document.createElement('article');
  card.className = 'product-card';
  card.dataset.productId = product._id;
  card.dataset.name = product.name;
  card.dataset.price = String(product.price);
  card.dataset.category = product.category;
  card.dataset.stock = String(product.stock || 0);

  const qty = cart.get(product.name)?.qty || 0;
  if (qty > 0) card.classList.add('selected');

  const isOutOfStock = (product.stock || 0) === 0;
  const stockDisplay = isOutOfStock ? 'Out of stock' : `${product.stock} available`;
  const stockClass = isOutOfStock ? 'out-of-stock' : 'in-stock';

  card.innerHTML = `
    <div class="product-image-shell">
      <img src="${product.image || 'assets/product-placeholder.svg'}" alt="${product.name}" />
    </div>
    <div class="product-info">
      <h4>${product.name}</h4>
      <strong>${money(product.price)}</strong>
      <small class="stock-status ${stockClass}">${stockDisplay}</small>
    </div>
    <div class="product-actions">
      <div class="qty-control">
        <button type="button" class="qty-minus" aria-label="Decrease ${product.name} quantity" ${isOutOfStock ? 'disabled' : ''}>−</button>
        <span class="qty-value">${qty}</span>
        <button type="button" class="qty-plus" aria-label="Increase ${product.name} quantity" ${isOutOfStock ? 'disabled' : ''}>+</button>
      </div>
      <span class="auto-cart-note">${isOutOfStock ? 'Currently unavailable' : 'Updates cart automatically'}</span>
    </div>
  `;

  const minus = card.querySelector('.qty-minus');
  const plus = card.querySelector('.qty-plus');
  
  if (!isOutOfStock) {
    minus.addEventListener('click', () => {
      updateQty(product.name, Number(product.price), (cart.get(product.name)?.qty || 0) - 1, product.stock);
    });
    plus.addEventListener('click', () => {
      updateQty(product.name, Number(product.price), (cart.get(product.name)?.qty || 0) + 1, product.stock);
    });
  }
  
  return card;
}

function updateQty(name, price, nextQty, maxStock = null) {
  const currentQty = cart.get(name)?.qty || 0;
  const safeQty = Math.max(0, Number(nextQty) || 0);
  
  // Enforce stock limits
  if (maxStock !== null && safeQty > maxStock) {
    showToast(`Only ${maxStock} items available`);
    return;
  }
  
  // Prevent going below 1 if item is in cart (allow 0 to remove)
  if (currentQty > 0 && safeQty === 0) {
    // Allow removal by going to 0
    cart.delete(name);
  } else if (safeQty === 0) {
    // Don't add item with 0 quantity
    return;
  } else {
    cart.set(name, { name, price, qty: safeQty, category: 'product' });
  }
  
  persistCart();

  document.querySelectorAll('.product-card').forEach((card) => {
    if (card.dataset.name === name) {
      const value = card.querySelector('.qty-value');
      const count = cart.get(name)?.qty || 0;
      if (value) value.textContent = String(count);
      card.classList.toggle('selected', count > 0);
      
      // Disable plus button if at max stock
      const plusBtn = card.querySelector('.qty-plus');
      if (plusBtn && maxStock !== null) {
        plusBtn.disabled = count >= maxStock;
      }
    }
  });

  renderCart();
}

function hasEnquiry() {
  return cart.size > 0 || Boolean(customRequest);
}

function customerDetailsValid() {
  return [customerFirstName, customerLastName, customerPhone, customerEmail, customerArea].every((field) => field && field.value.trim() && field.checkValidity());
}

function updateSendState() {
  const ready = hasEnquiry() && customerDetailsValid();
  if (sendCartWhatsApp) sendCartWhatsApp.disabled = !ready;
  if (!customerFormStatus) return;

  if (!hasEnquiry()) customerFormStatus.textContent = 'Add at least one product or a custom request before sending your enquiry.';
  else if (!customerDetailsValid()) customerFormStatus.textContent = 'Complete your first name, last name, phone number, email and area.';
  else customerFormStatus.textContent = 'Ready — your contact details and order will be included in the WhatsApp message.';
  customerFormStatus.classList.toggle('ready', ready);
}

function buildWhatsAppText() {
  const lines = ['Hi Sattwik Kitchen, I would like to send an order enquiry.', ''];
  lines.push('Customer details:', `First name: ${customerFirstName.value.trim()}`, `Last name: ${customerLastName.value.trim()}`, `Phone: ${customerPhone.value.trim()}`, `Email: ${customerEmail.value.trim()}`, `Area: ${customerArea.value.trim() || 'Not provided'}`, '');
  lines.push('Order requirement:');
  let subtotal = 0;
  cart.forEach((item) => {
    const lineTotal = Number(item.price) * Number(item.qty);
    subtotal += lineTotal;
    lines.push(`• ${item.name} × ${item.qty} — ${money(lineTotal)}`);
  });
  if (customRequest) lines.push(`• Custom request: ${customRequest}`);
  lines.push('', `Estimated item subtotal: ${money(subtotal)}`);
  lines.push('Please confirm availability, final price, and delivery/pickup options.');
  return lines.join('\n');
}

function renderCart() {
  cartItems.innerHTML = '';
  let subtotal = 0;
  let count = 0;

  cart.forEach((item) => {
    subtotal += Number(item.price) * Number(item.qty);
    count += Number(item.qty);

    const row = document.createElement('div');
    row.className = 'cart-item';
    row.innerHTML = `
      <div class="cart-item-main">
        <strong>${item.name}</strong>
        <small>${money(item.price)} each</small>
      </div>
      <div class="cart-item-price">${money(Number(item.price) * Number(item.qty))}</div>
      <div class="cart-item-stepper">
        <button type="button" aria-label="Decrease ${item.name}" data-product="${item.name}" data-delta="-1">−</button>
        <span>${item.qty}</span>
        <button type="button" aria-label="Increase ${item.name}" data-product="${item.name}" data-delta="1">+</button>
      </div>
      <button type="button" class="cart-item-remove" data-remove="${item.name}">Remove</button>
    `;
    cartItems.appendChild(row);
  });

  cartEmpty.classList.toggle('hidden', cart.size > 0 || Boolean(customRequest));
  const customAmt = customRequest ? Number(localStorage.getItem('sattwikCustomAmount') || 0) : 0;
  customCartNote.textContent = customRequest ? `Custom request: ${customRequest}${customAmt > 0 ? ` (${money(customAmt)})` : ''}` : '';
  customCartNote.classList.toggle('hidden', !customRequest);
  cartTotal.textContent = money(subtotal + customAmt);
  cartCount.textContent = String(count + (customRequest ? 1 : 0));
  cartButton?.classList.toggle('has-items', hasEnquiry());
  updateSendState();
}

cartItems?.addEventListener('click', (event) => {
  const stepper = event.target.closest('[data-delta]');
  if (stepper) {
    const productName = stepper.dataset.product;
    const item = cart.get(productName);
    if (item) {
      // Get current stock from product map
      const product = productMap.get(productName);
      const maxStock = product ? (product.stock || 0) : null;
      updateQty(productName, item.price, Number(item.qty) + Number(stepper.dataset.delta), maxStock);
    }
    return;
  }
  const removeButton = event.target.closest('[data-remove]');
  if (removeButton) {
    const productName = removeButton.dataset.remove;
    cart.delete(productName);
    persistCart();
    document.querySelectorAll('.product-card').forEach((card) => {
      if (card.dataset.name === productName) {
        const value = card.querySelector('.qty-value');
        if (value) value.textContent = '0';
        card.classList.remove('selected');
        
        // Re-enable plus button after removal
        const plusBtn = card.querySelector('.qty-plus');
        if (plusBtn) {
          const product = productMap.get(productName);
          const maxStock = product ? (product.stock || 0) : null;
          plusBtn.disabled = maxStock === 0;
        }
      }
    });
    renderCart();
  }
});

const productMap = new Map();
const fetchProducts = async () => {
  try {
    const response = await fetch('/api/products');
    if (!response.ok) throw new Error('Unable to load menu');
    const data = await response.json();
    const products = Array.isArray(data.products) ? data.products : [];
    products.forEach((product) => productMap.set(product.name, product));
    renderProductTiles(products);
  } catch (error) {
    const fallback = [
      { _id: '1', name: 'Tomato Pickle', category: 'Pickles', image: 'assets/product-placeholder.svg', price: 8.99 },
      { _id: '2', name: 'Mango Pickle', category: 'Pickles', image: 'https://res.cloudinary.com/spfurewl/image/upload/v1789330097/pickles.png', price: 9.99 },
      { _id: '3', name: 'Peanut Powder', category: 'Powders', image: 'assets/product-placeholder.svg', price: 6.99 },
      { _id: '4', name: 'Curry Leaf Powder', category: 'Powders', image: 'https://res.cloudinary.com/spfurewl/image/upload/v1789330130/powders.png', price: 11.99 }
    ];
    renderProductTiles(fallback);
    showToast('Menu loaded in offline fallback mode');
  }
};

fetchProducts();

customerDetailsForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  customerToken = localStorage.getItem('sattwikCustomerToken') || '';
  if (!customerToken) {
    persistCart();
    const returnUrl = `${window.location.pathname}?checkout=1${window.location.hash || '#menu'}`;
    window.location.href = `/customer/login.html?return=${encodeURIComponent(returnUrl)}`;
    return;
  }
  if (!customerDetailsValid() || !hasEnquiry()) {
    customerFormStatus.textContent = 'Add an item and complete your details before sending the order.';
    return;
  }

  const customAmountVal = Number(localStorage.getItem('sattwikCustomAmount') || 0);
  const itemsSubtotal = Array.from(cart.values()).reduce((sum, it) => sum + (Number(it.price || 0) * Number(it.qty || 0)), 0);
  const calculatedTotal = Math.round((itemsSubtotal + (customRequest ? customAmountVal : 0)) * 100) / 100;

  const payload = {
    customer: {
      firstName: customerFirstName.value.trim(),
      lastName: customerLastName.value.trim(),
      phone: customerPhone.value.trim(),
      email: customerEmail.value.trim(),
      area: customerArea.value.trim()
    },
    customRequest,
    customAmount: customAmountVal,
    totalAmount: calculatedTotal,
    items: Array.from(cart.values()).filter((item) => item.category !== 'tiffin').map((item) => ({
      productId: productMap.get(item.name)?._id || null,
      productName: item.name,
      quantity: item.qty,
      price: item.price
    })),
    tiffinPlans: Array.from(cart.values()).filter((item) => item.category === 'tiffin').map((item) => ({
      packageType: item.packageType,
      size: item.size,
      quantity: item.qty
    })),
    type: customRequest ? 'custom' : (Array.from(cart.values()).some((item) => item.category === 'tiffin') ? 'tiffin' : 'product')
  };

  try {
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerToken}` },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Could not save this order');

    const order = data.order;
    const whatsappText = `Hi Sattwik Kitchen, I have submitted order ${order.orderId || 'SK-ORDER'}.\n\nCustomer: ${customerFirstName.value.trim()} ${customerLastName.value.trim()}\nPhone: ${customerPhone.value.trim()}\nEmail: ${customerEmail.value.trim()}\nArea: ${customerArea.value.trim() || 'Not provided'}\n\nItems:\n${Array.from(cart.values()).map((item) => `• ${item.name} x ${item.qty} - ${money(item.price * item.qty)}`).join('\n')}${customRequest ? `\n• Custom request: ${customRequest}` : ''}\n\nSubtotal: ${money(order.totalAmount || 0)}\nPlease confirm availability and next steps.`;

    showToast(`Order ${order.orderId || 'saved'} received`);
    cart.clear();
    customRequest = '';
    localStorage.removeItem('sattwikCustomAmount');
    localStorage.removeItem('sattwikCart');
    renderCart();
    customerDetailsForm.reset();
    document.getElementById('customOrderText').value = '';
    document.getElementById('customOrderStatus').textContent = '';
    openCart();
    window.open(`https://wa.me/16725881282?text=${encodeURIComponent(whatsappText)}`, '_blank', 'noopener');
  } catch (error) {
    customerFormStatus.textContent = error.message || 'Your order could not be submitted.';
    customerFormStatus.classList.add('ready');
  }
});

[customerFirstName, customerLastName, customerPhone, customerEmail, customerArea].forEach((field) => {
  field?.addEventListener('input', updateSendState);
  field?.addEventListener('change', updateSendState);
});

document.getElementById('addCustomOrder')?.addEventListener('click', () => {
  const input = document.getElementById('customOrderText');
  const status = document.getElementById('customOrderStatus');
  const value = input.value.trim();
  if (!value) {
    status.textContent = 'Please add your custom order details first.';
    input.focus();
    return;
  }
  customRequest = value;
  const amount = customOrderAmount ? Number(customOrderAmount.value || 0) : 0;
  if (!Number.isFinite(amount) || amount < 0) {
    status.textContent = 'Enter a valid non-negative amount.';
    return;
  }
  localStorage.setItem('sattwikCustomAmount', String(amount));
  persistCart();
  status.textContent = 'Custom request added to your cart.';
  renderCart();
  openCart();
});

document.querySelectorAll('[data-tiffin]').forEach((button) => button.addEventListener('click', (event) => {
  event.preventDefault();
  const { package: pkg, size, price } = button.dataset;
  const planName = `${pkg === 'full' ? 'Full Meal Package' : 'Curry-Only Package'} (${size})`;
  const existing = cart.get(planName);
  cart.set(planName, { name: planName, price: Number(price), qty: existing ? existing.qty + 1 : 1, category: 'tiffin', packageType: pkg, size });
  persistCart();
  renderCart();
  openCart();
  showToast(`${planName} added to cart`);
}));

document.querySelectorAll('.plan-toggle button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.plan-toggle button').forEach((item) => item.classList.toggle('active', item === button));
    const full = document.getElementById('fullPlans');
    const curry = document.getElementById('curryPlans');
    if (button.dataset.plan === 'full') {
      full?.classList.remove('hidden');
      curry?.classList.add('hidden');
    } else {
      curry?.classList.remove('hidden');
      full?.classList.add('hidden');
    }
  });
});

document.getElementById('orderForm')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = document.getElementById('name').value.trim();
  const interest = document.getElementById('interest').value;
  const area = document.getElementById('area').value.trim();
  const details = document.getElementById('details').value.trim();
  const lines = [`Hi Sattwik Kitchen, my name is ${name}.`, `I'm interested in: ${interest}.`];
  if (area) lines.push(`My area: ${area}.`);
  if (details) lines.push(`Order details: ${details}`);
  lines.push('Please let me know the availability and price.');
  window.open(`https://wa.me/16725881282?text=${encodeURIComponent(lines.join('\n'))}`, '_blank', 'noopener');
});

document.getElementById('year').textContent = new Date().getFullYear();

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.1 });
document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));

renderCart();
loadSignedInCustomer();
if (new URLSearchParams(window.location.search).get('checkout') === '1') setTimeout(openCart, 0);
