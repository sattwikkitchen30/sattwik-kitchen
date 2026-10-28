function getOrderCustomer(order) {
  const customer = order?.customer && typeof order.customer === 'object'
    ? order.customer
    : {};
  const snapshot = order?.customerSnapshot || {};
  const value = (key) => {
    const custVal = customer[key];
    if (custVal !== undefined && custVal !== null && String(custVal).trim() !== '') {
      return String(custVal).trim();
    }
    return snapshot[key] ?? '';
  };
  return {
    ...snapshot,
    ...customer,
    firstName: value('firstName'),
    lastName: value('lastName'),
    phone: value('phone'),
    email: value('email'),
    address: value('address'),
    area: value('area')
  };
}

module.exports = { getOrderCustomer };
