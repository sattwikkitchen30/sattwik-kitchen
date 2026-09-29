const DELIVERY_STATUSES = ['PENDING', 'ACCEPTED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'];
const LEGACY_ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled'];
const ORDER_STATUSES = [...DELIVERY_STATUSES, ...LEGACY_ORDER_STATUSES];
const REVENUE_STATUSES = ['ACCEPTED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'confirmed', 'preparing', 'ready', 'delivered'];
const STATUS_TRANSITIONS = {
  PENDING: 'ACCEPTED',
  ACCEPTED: 'OUT_FOR_DELIVERY',
  OUT_FOR_DELIVERY: 'DELIVERED'
};

const TIFFIN_PRICES = {
  full: { single: 240, couple: 300, family: 340 },
  'curry-only': { single: 120, couple: 160, family: 200 }
};

const TIFFIN_LABELS = {
  full: 'Full Meal Package',
  'curry-only': 'Curry-Only Package'
};

const TIFFIN_PREPARATION_RULES = {
  full: {
    single: { dal: 'small', curry: 'small', chapati: 4, rice: 1, curd: 'small' },
    couple: { dal: 'medium', curry: 'medium', chapati: 4, rice: 1, curd: 'big' },
    family: { dal: 'large', curry: 'large', chapati: 6, rice: 1, curd: 'big' }
  },
  'curry-only': {
    single: { dal: 'small', curry: 'small', chapati: 0, rice: 0, curd: null },
    couple: { dal: 'medium', curry: 'medium', chapati: 0, rice: 0, curd: null },
    family: { dal: 'large', curry: 'large', chapati: 0, rice: 0, curd: null }
  }
};

const TIFFIN_MENU_BY_WEEKDAY = {
  Monday: {
    dalOptions: ['Palak Dal', 'Ridge Gourd Dal'],
    curryOptions: ['Brinjal Masala', 'Cauliflower Curry'],
    rice: ['White Rice'],
    chapati: ['4 Chapati'],
    curd: ['Homemade Curd']
  },
  Tuesday: {
    dalOptions: ['Tomato Dal', 'Kale Dal'],
    curryOptions: ['Cabbage Chutney', 'Capsicum Masala'],
    rice: ['White Rice'],
    chapati: ['4 Chapati'],
    curd: ['Homemade Curd']
  },
  Wednesday: {
    dalOptions: ['Mango Dal', 'Dal Tadka'],
    curryOptions: ['Potato/Bhindi Fry'],
    rice: ['Jeera Rice'],
    chapati: ['4 Chapati'],
    curd: ['Homemade Curd'],
    sweet: ['Sweet']
  },
  Thursday: {
    dalOptions: ['Sambar'],
    curryOptions: ['Aloo Tomato Curry', 'Bhindi Curry'],
    rice: ['White Rice'],
    chapati: ['4 Chapati'],
    curd: ['Homemade Curd']
  },
  Friday: {
    dalOptions: ['Chole Masala', 'Paneer Curry'],
    curryOptions: ['Poori', 'Chapati'],
    rice: ['Veg Biryani', 'Fried Rice'],
    curd: ['Raita']
  }
};

function tiffinDisplayName(packageType, size) {
  const p = TIFFIN_LABELS[packageType] || packageType;
  const s = size ? size[0].toUpperCase() + size.slice(1) : '';
  return `Tiffin Plan — ${p} (${s})`.replace(' ()', '');
}

function dateMatch(query = {}) {
  const { from, to } = query;
  const match = {};
  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = new Date(from + 'T00:00:00.000Z');
    if (to) match.createdAt.$lte = new Date(to + 'T23:59:59.999Z');
  }
  return match;
}

module.exports = {
  ORDER_STATUSES,
  DELIVERY_STATUSES,
  STATUS_TRANSITIONS,
  REVENUE_STATUSES,
  TIFFIN_PRICES,
  TIFFIN_LABELS,
  TIFFIN_PREPARATION_RULES,
  TIFFIN_MENU_BY_WEEKDAY,
  tiffinDisplayName,
  dateMatch
};
