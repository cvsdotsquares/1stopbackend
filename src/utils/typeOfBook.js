/**
 * Booking payment source (type_of_book) — labels, email ref suffixes, admin options.
 */

const TYPE_OF_BOOK_LABELS = {
  t: 'Terminal',
  m: 'MOTO',
  o: 'Online',
  r: 'RideTo',
  w: 'Worldpay',
  pl: 'Payment Link',
  bt: 'Bank Transfer',
  c: 'In Person',
  z: 'Zero Cost',
};

/** Shown on booking confirmation email: "1SRC12345 - PL" */
const BOOKING_REF_EMAIL_SUFFIX = {
  t: 'T',
  m: 'M',
  o: 'O',
  r: 'R2',
  w: 'W',
  pl: 'PL',
  bt: 'BT',
  c: 'C',
  z: 'Z',
};

/** booking_payments.payment_type for admin immediate completion (non-MOTO / non-Stripe checkout). */
const ADMIN_COMPLETION_PAYMENT_TYPE = {
  t: 'TERMINAL',
  bt: 'BANK_TRANSFER',
  c: 'IN_PERSON',
  z: 'ZERO_COST',
  pl: 'payment_link',
  r: 'RIDETO',
};

const ADMIN_WIZARD_PAYMENT_TYPE_VALUES = new Set(['t', 'bt', 'c', 'z', 'r']);

/** Values added beyond legacy enum('o','m','t','w','r'). */
const EXTENDED_TYPE_OF_BOOK_ENUM = ['pl', 'bt', 'c', 'z'];

let typeOfBookEnumReady = false;

function parseMysqlEnumColumnType(typeSql) {
  const match = String(typeSql || '').match(/^enum\((.*)\)$/i);
  if (!match) return null;
  return match[1]
    .split(',')
    .map((part) => part.trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1'));
}

/**
 * Legacy DB only allowed o/m/t/w/r — bt/pl/c/z were rejected and stored empty (email showed T).
 */
async function ensureTypeOfBookEnum(pool) {
  if (typeOfBookEnumReady || !pool) return;
  const [cols] = await pool.query("SHOW COLUMNS FROM bookings LIKE 'type_of_book'");
  const col = cols?.[0];
  if (!col) {
    typeOfBookEnumReady = true;
    return;
  }
  const values = parseMysqlEnumColumnType(col.Type);
  if (!values) {
    typeOfBookEnumReady = true;
    return;
  }
  const missing = EXTENDED_TYPE_OF_BOOK_ENUM.filter((v) => !values.includes(v));
  if (!missing.length) {
    typeOfBookEnumReady = true;
    return;
  }
  const next = [...values, ...missing]
    .map((value) => `'${String(value).replace(/'/g, "''")}'`)
    .join(',');
  const nullable = String(col.Null).toUpperCase() === 'YES' ? 'NULL' : 'NOT NULL';
  const defaultSql =
    col.Default == null || col.Default === ''
      ? ''
      : ` DEFAULT '${String(col.Default).replace(/'/g, "''")}'`;
  await pool.query(
    `ALTER TABLE bookings MODIFY COLUMN type_of_book ENUM(${next}) ${nullable}${defaultSql}`
  );
  typeOfBookEnumReady = true;
}

/** When type_of_book was not persisted, infer suffix from booking_payments.payment_type. */
function getBookingRefSuffixFromPaymentType(paymentType) {
  const key = String(paymentType || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (!key) return null;
  const map = {
    terminal: 'T',
    cash: 'T',
    bank_transfer: 'BT',
    in_person: 'C',
    zero_cost: 'Z',
    payment_link: 'PL',
    stripe_link: 'PL',
    moto: 'M',
    online: 'O',
    sale: null,
  };
  if (!Object.prototype.hasOwnProperty.call(map, key)) return null;
  return map[key];
}

/** Booking confirmation email ref suffix (PL, BT, T, …). */
function resolveBookingConfirmationRefSuffix({ typeOfBook, paymentType } = {}) {
  const stored = normalizeTypeOfBookCode(typeOfBook);
  if (stored && isExtendedTypeOfBookCode(stored)) {
    return getBookingRefEmailSuffix(stored);
  }
  const fromPayment = getBookingRefSuffixFromPaymentType(paymentType);
  if (fromPayment) return fromPayment;
  if (stored && isKnownTypeOfBookCode(stored)) {
    return getBookingRefEmailSuffix(stored);
  }
  if (stored === 'p') return 'PL';
  return getBookingRefEmailSuffix('t');
}

function normalizeTypeOfBookCode(value) {
  return String(value ?? '').trim().toLowerCase();
}

function getTypeOfBookLabel(code) {
  const c = normalizeTypeOfBookCode(code);
  if (!c) return '';
  return TYPE_OF_BOOK_LABELS[c] || c;
}

function getBookingRefEmailSuffix(code) {
  const c = normalizeTypeOfBookCode(code);
  if (!c) return 'T';
  // Legacy: type_of_book truncated to single char when pl could not be stored
  if (c === 'p') return 'PL';
  return BOOKING_REF_EMAIL_SUFFIX[c] || c.toUpperCase();
}

function isKnownTypeOfBookCode(value) {
  const c = normalizeTypeOfBookCode(value);
  return Boolean(c && Object.prototype.hasOwnProperty.call(BOOKING_REF_EMAIL_SUFFIX, c));
}

function isExtendedTypeOfBookCode(value) {
  const c = normalizeTypeOfBookCode(value);
  return EXTENDED_TYPE_OF_BOOK_ENUM.includes(c);
}

function resolveAdminWizardTypeOfBook({ adminPaymentType, paymentMode }) {
  if (paymentMode === 'worldpay') return 'm';
  if (paymentMode === 'stripe') return 'pl';
  const c = normalizeTypeOfBookCode(adminPaymentType);
  return ADMIN_WIZARD_PAYMENT_TYPE_VALUES.has(c) ? c : 't';
}

function getAdminCompletionPaymentType(typeOfBook) {
  const c = normalizeTypeOfBookCode(typeOfBook);
  return ADMIN_COMPLETION_PAYMENT_TYPE[c] || 'TERMINAL';
}

function getTransactionTypeFilterOptions() {
  return [
    { value: '', label: 'All types' },
    { value: 'o', label: 'Online' },
    { value: 't', label: 'Terminal' },
    { value: 'm', label: 'MOTO' },
    { value: 'r', label: 'RideTo' },
    { value: 'pl', label: 'Payment Link' },
    { value: 'bt', label: 'Bank Transfer' },
    { value: 'c', label: 'In Person' },
    { value: 'z', label: 'Zero Cost' },
  ];
}

function getAdminWizardPaymentTypeOptions() {
  return [
    { value: 't', label: 'Terminal' },
    { value: 'bt', label: 'Bank Transfer' },
    { value: 'c', label: 'In Person' },
    { value: 'z', label: 'Zero Cost' },
    { value: 'r', label: 'RideTo' },
  ];
}

/** Transactions list “Type” column (bookings + MOTO custom payments). */
function getTransactionTypeLabel({ typeOfBook, paymentType, transactionType } = {}) {
  const txType = String(transactionType || 'booking').trim().toLowerCase();
  const ptKey = String(paymentType || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');

  if (txType === 'custom_payment' || txType === 'gift_voucher') {
    if (ptKey === 'moto') return 'MOTO';
    if (ptKey) {
      return ptKey
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    }
    return 'MOTO';
  }

  const paymentLabelByType = {
    payment_link: 'Payment Link',
    stripe_link: 'Payment Link',
    terminal: 'Terminal',
    cash: 'Terminal',
    bank_transfer: 'Bank Transfer',
    in_person: 'In Person',
    zero_cost: 'Zero Cost',
    moto: 'MOTO',
    online: 'Online',
    sale: '',
  };
  if (ptKey && paymentLabelByType[ptKey]) {
    return paymentLabelByType[ptKey];
  }

  const fromTob = getTypeOfBookLabel(typeOfBook);
  if (fromTob) return fromTob;

  if (ptKey === 'sale') return 'Online';
  return paymentType || '';
}

module.exports = {
  TYPE_OF_BOOK_LABELS,
  ADMIN_WIZARD_PAYMENT_TYPE_VALUES,
  getTypeOfBookLabel,
  getBookingRefEmailSuffix,
  getBookingRefSuffixFromPaymentType,
  resolveBookingConfirmationRefSuffix,
  isKnownTypeOfBookCode,
  isExtendedTypeOfBookCode,
  resolveAdminWizardTypeOfBook,
  getAdminCompletionPaymentType,
  getTransactionTypeFilterOptions,
  getAdminWizardPaymentTypeOptions,
  getTransactionTypeLabel,
  normalizeTypeOfBookCode,
  ensureTypeOfBookEnum,
};
