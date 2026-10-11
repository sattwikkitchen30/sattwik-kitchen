function getOrderCustomer(order) {
  const customer = order?.customer && typeof order.customer === 'object'
    ? order.customer
    : {};
  const snapshot = order?.customerSnapshot || {};
  const value = (key) => Object.prototype.hasOwnProperty.call(snapshot, key)
    ? snapshot[key] ?? ''
    : customer[key] || '';
  return {
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
