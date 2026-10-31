// ─── Sattwik Kitchen About Us Page Script ─────────────────────────────────────
const navToggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');
const customerAccountLink = document.getElementById('customerAccountLink');
const customerOrdersLink = document.getElementById('customerOrdersLink');
const customerLogoutBtn = document.getElementById('customerLogoutBtn');
let customerProfileBtn = document.getElementById('customerProfileBtn');
let customerToken = localStorage.getItem('sattwikCustomerToken') || '';

// Mobile Navigation Toggle
navToggle?.addEventListener('click', () => {
  if (!navLinks) return;
  const open = navLinks.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
});

document.querySelectorAll('.nav-links a').forEach((link) => {
  link.addEventListener('click', () => {
    navLinks?.classList.remove('open');
    navToggle?.setAttribute('aria-expanded', 'false');
  });
});

// Dynamic Footer Year
const yearEl = document.getElementById('year');
if (yearEl) {
  yearEl.textContent = new Date().getFullYear();
}

// Customer Auth UI State Management
function updateCustomerAuthUI() {
  customerToken = localStorage.getItem('sattwikCustomerToken') || '';
  if (!customerProfileBtn && typeof document !== 'undefined') {
    customerProfileBtn = document.getElementById('customerProfileBtn');
  }
  if (customerToken) {
    customerAccountLink?.classList.add('hidden');
    customerOrdersLink?.classList.remove('hidden');
    customerProfileBtn?.classList.remove('hidden');
    customerLogoutBtn?.classList.remove('hidden');
  } else {
    customerAccountLink?.classList.remove('hidden');
    customerOrdersLink?.classList.add('hidden');
    customerProfileBtn?.classList.add('hidden');
    customerLogoutBtn?.classList.add('hidden');
  }
}

updateCustomerAuthUI();

if (typeof window !== 'undefined') {
  window.addEventListener('pageshow', () => updateCustomerAuthUI());
  window.addEventListener('storage', (event) => {
    if (event.key === 'sattwikCustomerToken' || event.key === 'sattwikCustomer') {
      updateCustomerAuthUI();
    }
  });
}

// Customer Logout
async function performCustomerLogout() {
  const currentToken = localStorage.getItem('sattwikCustomerToken');
  try {
    if (currentToken) {
      await fetch('/api/customer-auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${currentToken}` }
      });
    }
  } catch (_err) {
    // Local logout completes regardless of network status
  }
  localStorage.removeItem('sattwikCustomerToken');
  localStorage.removeItem('sattwikCustomer');
  updateCustomerAuthUI();
  window.location.href = '/';
}

customerLogoutBtn?.addEventListener('click', (event) => {
  event.preventDefault();
  performCustomerLogout();
});

// ─── Customer Edit Profile Modal ──────────────────────────────────────────
const customerProfileModal = document.getElementById('customerProfileModal');
const closeCustomerProfileModal = document.getElementById('closeCustomerProfileModal');
const cancelCustomerProfileBtn = document.getElementById('cancelCustomerProfileBtn');
const customerProfileForm = document.getElementById('customerProfileForm');
const customerProfileMessage = document.getElementById('customerProfileMessage');
const editCustomerFirstName = document.getElementById('editCustomerFirstName');
const editCustomerLastName = document.getElementById('editCustomerLastName');
const editCustomerEmail = document.getElementById('editCustomerEmail');
const editCustomerPhone = document.getElementById('editCustomerPhone');
const editCustomerArea = document.getElementById('editCustomerArea');
const editCustomerAddress = document.getElementById('editCustomerAddress');
const saveCustomerProfileBtn = document.getElementById('saveCustomerProfileBtn');

function openCustomerProfileModal() {
  if (!customerProfileModal) return;
  customerProfileModal.style.display = 'flex';
  if (customerProfileMessage) {
    customerProfileMessage.textContent = '';
    customerProfileMessage.className = 'profile-message';
  }
  if (saveCustomerProfileBtn) {
    saveCustomerProfileBtn.disabled = false;
    saveCustomerProfileBtn.textContent = 'Save Changes';
  }

  let cust = null;
  try {
    const stored = localStorage.getItem('sattwikCustomer');
    if (stored) cust = JSON.parse(stored);
  } catch (_e) {}

  if (editCustomerFirstName) editCustomerFirstName.value = cust?.firstName || '';
  if (editCustomerLastName) editCustomerLastName.value = cust?.lastName || '';
  if (editCustomerEmail) editCustomerEmail.value = cust?.email || '';
  if (editCustomerPhone) editCustomerPhone.value = cust?.phone || '';
  if (editCustomerArea) editCustomerArea.value = cust?.area || cust?.deliveryArea || '';
  if (editCustomerAddress) editCustomerAddress.value = cust?.address || cust?.deliveryAddress || '';

  // Background fetch fresh customer data
  const currentTok = localStorage.getItem('sattwikCustomerToken');
  if (currentTok) {
    fetch('/api/customer-auth/me', { headers: { Authorization: `Bearer ${currentTok}` } })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d && d.customer && customerProfileModal.style.display === 'flex') {
          const c = d.customer;
          localStorage.setItem('sattwikCustomer', JSON.stringify(c));
          if (editCustomerFirstName && document.activeElement !== editCustomerFirstName) editCustomerFirstName.value = c.firstName || '';
          if (editCustomerLastName && document.activeElement !== editCustomerLastName) editCustomerLastName.value = c.lastName || '';
          if (editCustomerEmail && document.activeElement !== editCustomerEmail) editCustomerEmail.value = c.email || '';
          if (editCustomerPhone && document.activeElement !== editCustomerPhone) editCustomerPhone.value = c.phone || '';
          if (editCustomerArea && document.activeElement !== editCustomerArea) editCustomerArea.value = c.area || c.deliveryArea || '';
          if (editCustomerAddress && document.activeElement !== editCustomerAddress) editCustomerAddress.value = c.address || c.deliveryAddress || '';
        }
      })
      .catch(() => {});
  }

  setTimeout(() => {
    editCustomerFirstName?.focus();
  }, 80);
}

function closeCustomerProfileModalDialog() {
  if (!customerProfileModal) return;
  customerProfileModal.style.display = 'none';
  if (customerProfileMessage) {
    customerProfileMessage.textContent = '';
    customerProfileMessage.className = 'profile-message';
  }
}

customerProfileBtn?.addEventListener('click', openCustomerProfileModal);
closeCustomerProfileModal?.addEventListener('click', closeCustomerProfileModalDialog);
cancelCustomerProfileBtn?.addEventListener('click', closeCustomerProfileModalDialog);

customerProfileModal?.addEventListener('click', (e) => {
  if (e.target === customerProfileModal) closeCustomerProfileModalDialog();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && customerProfileModal && customerProfileModal.style.display === 'flex') {
    closeCustomerProfileModalDialog();
  }
});

customerProfileForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (customerProfileMessage) {
    customerProfileMessage.textContent = 'Saving changes...';
    customerProfileMessage.className = 'profile-message';
  }
  if (saveCustomerProfileBtn) {
    saveCustomerProfileBtn.disabled = true;
    saveCustomerProfileBtn.textContent = 'Saving...';
  }

  const firstName = editCustomerFirstName ? editCustomerFirstName.value.trim() : '';
  const lastName = editCustomerLastName ? editCustomerLastName.value.trim() : '';
  const email = editCustomerEmail ? editCustomerEmail.value.trim().toLowerCase() : '';
  const phone = editCustomerPhone ? editCustomerPhone.value.trim() : '';
  const area = editCustomerArea ? editCustomerArea.value.trim() : '';
  const address = editCustomerAddress ? editCustomerAddress.value.trim() : '';

  if (!firstName) {
    customerProfileMessage.textContent = 'First name is required.';
    customerProfileMessage.className = 'profile-message error';
    saveCustomerProfileBtn.disabled = false;
    saveCustomerProfileBtn.textContent = 'Save Changes';
    return;
  }
  if (!lastName) {
    customerProfileMessage.textContent = 'Last name is required.';
    customerProfileMessage.className = 'profile-message error';
    saveCustomerProfileBtn.disabled = false;
    saveCustomerProfileBtn.textContent = 'Save Changes';
    return;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    customerProfileMessage.textContent = 'Please provide a valid email address.';
    customerProfileMessage.className = 'profile-message error';
    saveCustomerProfileBtn.disabled = false;
    saveCustomerProfileBtn.textContent = 'Save Changes';
    return;
  }
  if (!phone || !/^[\d+\-()\s]{7,40}$/.test(phone)) {
    customerProfileMessage.textContent = 'Please provide a valid phone number.';
    customerProfileMessage.className = 'profile-message error';
    saveCustomerProfileBtn.disabled = false;
    saveCustomerProfileBtn.textContent = 'Save Changes';
    return;
  }

  const currentTok = localStorage.getItem('sattwikCustomerToken');
  try {
    const res = await fetch('/api/customer-auth/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${currentTok}`
      },
      body: JSON.stringify({ firstName, lastName, email, phone, area, address, deliveryArea: area, deliveryAddress: address })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || 'Failed to update profile.');
    }

    if (data.customer) {
      localStorage.setItem('sattwikCustomer', JSON.stringify(data.customer));
    }
    if (data.token) {
      localStorage.setItem('sattwikCustomerToken', data.token);
    }

    customerProfileMessage.textContent = data.message || 'Profile updated successfully!';
    customerProfileMessage.className = 'profile-message success';

    setTimeout(() => {
      closeCustomerProfileModalDialog();
    }, 1400);
  } catch (err) {
    customerProfileMessage.textContent = err.message || 'Failed to update profile.';
    customerProfileMessage.className = 'profile-message error';
  } finally {
    if (saveCustomerProfileBtn) {
      saveCustomerProfileBtn.disabled = false;
      saveCustomerProfileBtn.textContent = 'Save Changes';
    }
  }
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    updateCustomerAuthUI,
    openCustomerProfileModal,
    closeCustomerProfileModalDialog,
    performCustomerLogout
  };
}
