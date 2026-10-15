const { TIFFIN_PREPARATION_RULES } = require('./constants');

const TIFFIN_PREPARATION_ITEMS = {
  smallDal: { productName: 'Small Dal', category: 'Tiffin Preparation' },
  mediumDal: { productName: 'Medium Dal', category: 'Tiffin Preparation' },
  largeDal: { productName: 'Large Dal', category: 'Tiffin Preparation' },
  smallCurry: { productName: 'Small Curry', category: 'Tiffin Preparation' },
  mediumCurry: { productName: 'Medium Curry', category: 'Tiffin Preparation' },
  largeCurry: { productName: 'Large Curry', category: 'Tiffin Preparation' },
  chapathi: { productName: 'Chapathi', category: 'Tiffin Preparation' },
  riceBox: { productName: 'Rice Box', category: 'Tiffin Preparation' },
  smallCurd: { productName: 'Small Curd', category: 'Tiffin Preparation' },
  bigCurd: { productName: 'Big Curd', category: 'Tiffin Preparation' }
};

const PREPARATION_TYPES = Object.keys(TIFFIN_PREPARATION_ITEMS);

function getTiffinPreparationType(productName) {
  const name = String(productName || '').toLowerCase();
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
  return null;
}

function buildDefaultTiffinItems(plans = []) {
  const quantities = new Map();

  for (const plan of plans) {
    if (!plan || !plan.packageType || !plan.size) continue;
    const rule = TIFFIN_PREPARATION_RULES[plan.packageType]?.[plan.size];
    if (!rule) continue;

    const planQuantity = Number(plan.quantity);
    const multiplier = Number.isFinite(planQuantity) && planQuantity > 0 ? planQuantity : 1;
    const components = [
      [`${rule.dal}Dal`, 1],
      [`${rule.curry}Curry`, 1]
    ];

    if (rule.chapati) components.push(['chapathi', rule.chapati]);
    if (rule.rice) components.push(['riceBox', rule.rice]);
    if (rule.curd) components.push([rule.curd === 'big' ? 'bigCurd' : 'smallCurd', 1]);

    for (const [preparationType, quantity] of components) {
      quantities.set(preparationType, (quantities.get(preparationType) || 0) + quantity * multiplier);
    }
  }

  return [...quantities].map(([preparationType, quantity]) => ({
    productId: null,
    productName: TIFFIN_PREPARATION_ITEMS[preparationType].productName,
    category: TIFFIN_PREPARATION_ITEMS[preparationType].category,
    preparationType,
    quantity
  }));
}

function isDeliveryTiffinOrder(order) {
  if (!order) return false;
  const items = Array.isArray(order.items) ? order.items : [];

  const hasDeliveryItems = items.some((item) => (item.fulfillment || order.fulfillment) === 'delivery');
  const isOrderDeliveryFulfillment = order.fulfillment === 'delivery' || order.fulfillment === 'mixed';
  if (!hasDeliveryItems && !isOrderDeliveryFulfillment) {
    return false;
  }

  if (items.length > 0 && items.every((i) => i.fulfillment === 'pickup')) {
    return false;
  }

  const hasDeliveryPlanItem = items.some((item) => {
    const isDelivery = (item.fulfillment || order.fulfillment) === 'delivery';
    if (!isDelivery) return false;
    const cat = String(item.category || '').toLowerCase();
    const name = String(item.productName || '');
    return cat === 'tiffin plans'
      || cat === 'tiffin preparation'
      || cat === 'tiffin'
      || /^(?:Tiffin Plan\s*[-—–:]\s*)?(?:Full Meal Package|Curry(?:-|\s+)Only Package)\s*\(/i.test(name)
      || /^(?:Full Meal|Curry(?:-|\s+)Only)\b/i.test(name);
  });

  if (hasDeliveryPlanItem) return true;

  const hasTiffinTypeOrPlan = order.type === 'tiffin'
    || Boolean(order.tiffinPlan?.packageType);

  if (hasTiffinTypeOrPlan && (hasDeliveryItems || isOrderDeliveryFulfillment)) {
    return true;
  }

  return false;
}

function getLegacyOrderTiffinItems(order, fallbackPlan = null) {
  if (Array.isArray(order?.tiffinItems)
    && (order.tiffinItems.length > 0 || order.tiffinItemsCustomized)) {
    return order.tiffinItems;
  }

  const packageItem = (order?.items || []).find((item) => {
    const isDelivery = item.fulfillment === 'delivery' || (!item.fulfillment && order.fulfillment === 'delivery');
    const cat = String(item.category || '').toLowerCase();
    const name = String(item.productName || '');
    return isDelivery && (
      cat === 'tiffin plans'
      || cat === 'tiffin preparation'
      || cat === 'tiffin'
      || /^(?:Tiffin Plan\s*[-—–:]\s*)?(?:Full Meal Package|Curry(?:-|\s+)Only Package)\s*\(/i.test(name)
      || /^(?:Full Meal|Curry(?:-|\s+)Only)\b/i.test(name)
    );
  }) || (order?.items || []).find((item) => item.category === 'Tiffin Plans');

  const packageQuantity = packageItem?.quantity || 1;
  let packageType = order?.tiffinPlan?.packageType;
  let size = order?.tiffinPlan?.size;

  if ((!packageType || !size) && packageItem) {
    const match = String(packageItem.productName || '').match(/(Full\s*Meal|Curry(?:-|\s*)Only)(?:\s+Package)?(?:\s*\(|\s*[-—–:]\s*)(Single|Couple|Family)\)?/i);
    if (match) {
      if (!packageType) packageType = /^curry/i.test(match[1]) ? 'curry-only' : 'full';
      if (!size) size = match[2].toLowerCase();
    }
  }

  const orderPlan = {
    packageType,
    size,
    quantity: packageQuantity
  };
  const orderItems = buildDefaultTiffinItems([orderPlan]);
  if (orderItems.length) return orderItems;

  return buildDefaultTiffinItems([{
    packageType: fallbackPlan?.packageType,
    size: fallbackPlan?.size,
    quantity: packageQuantity
  }]);
}

module.exports = {
  TIFFIN_PREPARATION_ITEMS,
  PREPARATION_TYPES,
  getTiffinPreparationType,
  buildDefaultTiffinItems,
  getLegacyOrderTiffinItems,
  isDeliveryTiffinOrder
};
