const { TIFFIN_PREPARATION_ITEMS, PREPARATION_TYPES, getTiffinPreparationType } = require('./tiffinItems');

const SIZE_ALIASES = {
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

const SIZE_LABELS = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large'
};

const PREFERRED_ITEM_ORDER = ['dal', 'curry', 'chapati', 'rice', 'curd'];

const PREP_TYPE_BY_ITEM = {
  dal: (size) => `${size}Dal`,
  curry: (size) => `${size}Curry`,
  curd: (size) => (size === 'large' ? 'bigCurd' : size === 'small' ? 'smallCurd' : null),
  chapati: () => 'chapathi',
  rice: () => 'riceBox'
};

const CANONICAL_ITEM_NAMES = {
  dal: 'Dal',
  curry: 'Curry',
  chapati: 'Chapati',
  rice: 'Rice',
  curd: 'Curd'
};

function normalizeItemKey(name) {
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

function parseSizeToken(quantity) {
  const value = String(quantity || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return SIZE_ALIASES[value] || null;
}

function collectPlanComponentRows(plan) {
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
    for (const row of collectPlanComponentRows(plan)) {
      const key = normalizeItemKey(row.name);
      if (!key) continue;
      const size = parseSizeToken(row.quantity);
      const displayName = CANONICAL_ITEM_NAMES[key] || (row.name ? row.name[0].toUpperCase() + row.name.slice(1) : row.name);
      const existing = byKey.get(key) || {
        key,
        name: displayName,
        sizes: [],
        supportsSize: false
      };
      if (!byKey.has(key)) byKey.set(key, existing);
      if (size && !existing.sizes.includes(size)) existing.sizes.push(size);
    }
  }

  const catalog = [...byKey.values()].map((item) => {
    const sizeOrder = ['small', 'medium', 'large'];
    const sizes = item.key === 'chapati'
      ? []
      : item.sizes.slice().sort((a, b) => sizeOrder.indexOf(a) - sizeOrder.indexOf(b));
    return {
      key: item.key,
      name: item.name,
      sizes,
      supportsSize: item.key !== 'chapati' && sizes.length > 0
    };
  });

  catalog.sort((a, b) => {
    const aIndex = PREFERRED_ITEM_ORDER.indexOf(a.key);
    const bIndex = PREFERRED_ITEM_ORDER.indexOf(b.key);
    if (aIndex !== -1 || bIndex !== -1) {
      return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
    }
    return a.name.localeCompare(b.name);
  });

  return catalog;
}

function resolveDeliveryCatalogSelection(catalogItem, size) {
  if (!catalogItem) return { error: 'Choose a delivery item.' };
  const sizeKey = parseSizeToken(size);
  if (catalogItem.supportsSize) {
    if (!sizeKey || !catalogItem.sizes.includes(sizeKey)) {
      return { error: `Choose a valid size for ${catalogItem.name}.` };
    }
  }

  const prepFactory = PREP_TYPE_BY_ITEM[catalogItem.key];
  if (prepFactory) {
    const preparationType = catalogItem.supportsSize ? prepFactory(sizeKey) : prepFactory();
    const component = TIFFIN_PREPARATION_ITEMS[preparationType];
    if (!component) return { error: 'Selected size is not available for this item.' };
    return {
      productId: null,
      productName: component.productName,
      category: component.category,
      preparationType
    };
  }

  const productName = catalogItem.supportsSize && sizeKey
    ? `${SIZE_LABELS[sizeKey]} ${catalogItem.name}`
    : catalogItem.name;
  return {
    productId: null,
    productName,
    category: 'Tiffin Preparation',
    preparationType: catalogItem.key
  };
}

function additionalTiffinItemToRow(item) {
  const preparationType = item?.preparationType;
  const mapped = {
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
  }[preparationType];
  if (mapped) {
    return {
      itemKey: item?.itemKey || mapped.itemKey,
      size: item?.size !== undefined && item?.size !== null ? item.size : mapped.size,
      quantity: Number(item?.quantity) || 1
    };
  }
  return {
    itemKey: item?.itemKey || normalizeItemKey(item?.productName),
    size: item?.size || '',
    quantity: Number(item?.quantity) || 1
  };
}

function getCanonicalIdentity(item) {
  if (!item) return '';
  if (item.productId) return `product:${String(item.productId)}`;

  if (item.preparationType && PREPARATION_TYPES.includes(item.preparationType)) {
    return item.preparationType;
  }

  const detectedPrep = getTiffinPreparationType(item.productName);
  if (detectedPrep && PREPARATION_TYPES.includes(detectedPrep)) {
    return detectedPrep;
  }

  const rawKey = normalizeItemKey(item.itemKey || item.productName);
  const size = parseSizeToken(item.size) || (item.size ? String(item.size).toLowerCase() : null);

  const prepFactory = PREP_TYPE_BY_ITEM[rawKey];
  if (prepFactory) {
    const resolvedType = size ? prepFactory(size) : prepFactory();
    if (resolvedType && PREPARATION_TYPES.includes(resolvedType)) {
      return resolvedType;
    }
  }

  return size ? `${rawKey}:${size}` : rawKey;
}

function resolveCustomItem(item) {
  const rawName = String(item?.customName || item?.productName || '').trim();
  if (!rawName || rawName === '+ Add' || rawName === '+Add' || rawName === '__custom__') {
    return { error: 'Enter a valid custom item name.' };
  }
  const size = parseSizeToken(item?.size);
  const sizeLabel = size ? (SIZE_LABELS[size] || (size[0].toUpperCase() + size.slice(1))) : '';
  const alreadyHasSize = sizeLabel && new RegExp(`^${sizeLabel}\\b`, 'i').test(rawName);
  const productName = sizeLabel && !alreadyHasSize ? `${sizeLabel} ${rawName}` : rawName;
  const prepType = getTiffinPreparationType(productName);
  const key = normalizeItemKey(rawName);

  return {
    productId: null,
    productName,
    category: 'Tiffin Preparation',
    preparationType: prepType || key,
    itemKey: key,
    size: size || null
  };
}

module.exports = {
  SIZE_LABELS,
  SIZE_ALIASES,
  normalizeItemKey,
  parseSizeToken,
  extractDeliveryCatalogItems,
  resolveDeliveryCatalogSelection,
  additionalTiffinItemToRow,
  getCanonicalIdentity,
  resolveCustomItem
};
