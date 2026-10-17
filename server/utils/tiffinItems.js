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

const TIFFIN_PREP_KEY_MAP = {
  smallDal: { itemKey: 'dal', size: 'small' },
  mediumDal: { itemKey: 'dal', size: 'medium' },
  largeDal: { itemKey: 'dal', size: 'large' },
  smallCurry: { itemKey: 'curry', size: 'small' },
  mediumCurry: { itemKey: 'curry', size: 'medium' },
  largeCurry: { itemKey: 'curry', size: 'large' },
  smallCurd: { itemKey: 'curd', size: 'small' },
  bigCurd: { itemKey: 'curd', size: 'large' },
  chapathi: { itemKey: 'chapati', size: null },
  riceBox: { itemKey: 'rice', size: null }
};

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

  if ((Array.isArray(order.tiffinItems) && order.tiffinItems.length > 0) || order.tiffinItemsCustomized) {
    return true;
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
      || /^(?:Full Meal|Curry(?:-|\s+)Only)\b/i.test(name)
      || Boolean(getTiffinPreparationType(name))
      || Boolean(item.preparationType);
  });

  if (hasDeliveryPlanItem) return true;

  const hasTiffinTypeOrPlan = order.type === 'tiffin'
    || Boolean(order.tiffinPlan?.packageType);

  if (hasTiffinTypeOrPlan && (hasDeliveryItems || isOrderDeliveryFulfillment)) {
    return true;
  }

  return false;
}

function buildOrderTiffinItems(items = [], tiffinPlan = null, fallbackPlan = null) {
  const { getCanonicalIdentity, normalizeItemKey, parseSizeToken } = require('./deliveryCatalogItems');

  const deliveryItems = (Array.isArray(items) ? items : []).filter((item) => {
    return item?.fulfillment !== 'pickup';
  });

  const resolvedItems = [];

  for (const item of deliveryItems) {
    const rawQuantity = Number(item?.quantity);
    const qty = Number.isSafeInteger(rawQuantity) && rawQuantity > 0 ? rawQuantity : 1;
    const name = String(item?.productName || '').trim();
    const cat = String(item?.category || '').trim().toLowerCase();

    // 1. Check if item matches a Full Meal or Curry-Only package bundle
    const match = name.match(/(Full\s*Meal|Curry(?:-|\s*)Only)(?:\s+Package)?(?:\s*\(|\s*[-—–:]\s*)(Single|Couple|Family)\)?/i);
    let pkgType = match ? (/^curry/i.test(match[1]) ? 'curry-only' : 'full') : null;
    let pkgSize = match ? match[2].toLowerCase() : null;

    if (!pkgType && (cat === 'tiffin plans' || /^(?:Full Meal|Curry(?:-|\s+)Only)\b/i.test(name))) {
      pkgType = tiffinPlan?.packageType || (/^curry/i.test(name) ? 'curry-only' : 'full');
      pkgSize = tiffinPlan?.size || null;
    }

    if (pkgType && pkgSize) {
      const expandedDefaults = buildDefaultTiffinItems([{
        packageType: pkgType,
        size: pkgSize,
        quantity: qty
      }]);
      for (const def of expandedDefaults) {
        const mapped = TIFFIN_PREP_KEY_MAP[def.preparationType];
        resolvedItems.push({
          productId: null,
          productName: def.productName,
          category: def.category || 'Tiffin Preparation',
          preparationType: def.preparationType,
          quantity: def.quantity,
          isAdditional: false,
          itemKey: mapped?.itemKey || null,
          size: mapped?.size || null,
          originalQuantity: def.quantity,
          additionalQuantity: 0
        });
      }
      continue;
    }

    // 2. Check if item is a preparation item (e.g. Small Dal, Chapathi, etc.)
    let prepType = (item?.preparationType && PREPARATION_TYPES.includes(item.preparationType))
      ? item.preparationType
      : getTiffinPreparationType(name);

    if (!prepType && (item?.itemKey || name)) {
      const key = normalizeItemKey(item?.itemKey || name);
      const sizeToken = parseSizeToken(item?.size);
      if (key === 'dal') prepType = `${sizeToken || 'small'}Dal`;
      else if (key === 'curry') prepType = `${sizeToken || 'small'}Curry`;
      else if (key === 'curd') prepType = sizeToken === 'large' ? 'bigCurd' : 'smallCurd';
      else if (key === 'chapati') prepType = 'chapathi';
      else if (key === 'rice') prepType = 'riceBox';
    }

    const isAdditional = Boolean(item?.isAdditional);
    const originalQuantity = Number.isInteger(item?.originalQuantity)
      ? item.originalQuantity
      : (!isAdditional ? qty : 0);
    const additionalQuantity = Number.isInteger(item?.additionalQuantity)
      ? item.additionalQuantity
      : (isAdditional ? qty : 0);

    if (prepType && PREPARATION_TYPES.includes(prepType)) {
      const prepInfo = TIFFIN_PREPARATION_ITEMS[prepType];
      const mapped = TIFFIN_PREP_KEY_MAP[prepType];
      resolvedItems.push({
        productId: item?.productId || null,
        productName: prepInfo?.productName || name,
        category: prepInfo?.category || 'Tiffin Preparation',
        preparationType: prepType,
        quantity: qty,
        isAdditional: Boolean(isAdditional || additionalQuantity > 0),
        itemKey: item?.itemKey || mapped?.itemKey || null,
        size: item?.size !== undefined && item?.size !== null ? item.size : (mapped?.size || null),
        originalQuantity,
        additionalQuantity
      });
      continue;
    }

    // 3. Custom delivery item or catalog item not in the 10 prep types
    resolvedItems.push({
      productId: item?.productId || null,
      productName: name,
      category: item?.category || 'Tiffin Preparation',
      preparationType: item?.preparationType || null,
      quantity: qty,
      isAdditional: Boolean(isAdditional || additionalQuantity > 0),
      itemKey: item?.itemKey || normalizeItemKey(name) || null,
      size: item?.size || null,
      originalQuantity,
      additionalQuantity
    });
  }

  // If no items were resolved from deliveryItems, try tiffinPlan or fallbackPlan
  if (resolvedItems.length === 0) {
    const planToExpand = (tiffinPlan?.packageType && tiffinPlan?.size)
      ? tiffinPlan
      : (fallbackPlan?.packageType && fallbackPlan?.size)
        ? fallbackPlan
        : null;

    if (planToExpand) {
      const planQty = Math.max(1, Number(planToExpand.quantity) || 1);
      const expandedDefaults = buildDefaultTiffinItems([{
        packageType: planToExpand.packageType,
        size: planToExpand.size,
        quantity: planQty
      }]);
      for (const def of expandedDefaults) {
        const mapped = TIFFIN_PREP_KEY_MAP[def.preparationType];
        resolvedItems.push({
          productId: null,
          productName: def.productName,
          category: def.category || 'Tiffin Preparation',
          preparationType: def.preparationType,
          quantity: def.quantity,
          isAdditional: false,
          itemKey: mapped?.itemKey || null,
          size: mapped?.size || null,
          originalQuantity: def.quantity,
          additionalQuantity: 0
        });
      }
    }
  }

  // Merge items with identical canonical identities
  const mergedMap = new Map();
  for (const item of resolvedItems) {
    const identity = getCanonicalIdentity(item);
    if (!mergedMap.has(identity)) {
      mergedMap.set(identity, { ...item });
    } else {
      const existing = mergedMap.get(identity);
      existing.quantity += item.quantity;
      existing.originalQuantity += item.originalQuantity;
      existing.additionalQuantity += item.additionalQuantity;
      existing.isAdditional = Boolean(existing.isAdditional || item.isAdditional || existing.additionalQuantity > 0);
    }
  }

  return [...mergedMap.values()];
}

function getLegacyOrderTiffinItems(order, fallbackPlan = null) {
  if (Array.isArray(order?.tiffinItems)
    && (order.tiffinItems.length > 0 || order.tiffinItemsCustomized)) {
    return order.tiffinItems;
  }

  return buildOrderTiffinItems(order?.items, order?.tiffinPlan, fallbackPlan);
}

module.exports = {
  TIFFIN_PREPARATION_ITEMS,
  PREPARATION_TYPES,
  TIFFIN_PREP_KEY_MAP,
  getTiffinPreparationType,
  buildDefaultTiffinItems,
  buildOrderTiffinItems,
  getLegacyOrderTiffinItems,
  isDeliveryTiffinOrder
};
