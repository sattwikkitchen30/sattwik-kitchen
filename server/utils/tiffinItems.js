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
    const multiplier = Number.isInteger(planQuantity) && planQuantity > 0 ? planQuantity : 1;
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

function getLegacyOrderTiffinItems(order, fallbackPlan = null) {
  if (Array.isArray(order?.tiffinItems)
    && (order.tiffinItems.length > 0 || order.tiffinItemsCustomized)) {
    return order.tiffinItems;
  }

  const packageItem = (order?.items || []).find((item) => item.category === 'Tiffin Plans');
  const packageQuantity = packageItem?.quantity || 1;
  const orderPlan = {
    packageType: order?.tiffinPlan?.packageType,
    size: order?.tiffinPlan?.size,
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
  getLegacyOrderTiffinItems
};
