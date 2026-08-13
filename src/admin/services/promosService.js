/**
 * Admin promo codes — port of legacy promos.php / add_promo.php / edit_promo.php.
 * Field names align with adminBookingPromoService.js validation.
 */
const RECORDS_PER_PAGE = 10;
/** Legacy NOT NULL date columns use zero-dates when unset (PHP inserts ''). */
const ZERO_DATE = '0000-00-00';

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function nowMysql() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function toDateOrEmpty(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime()) || value.getFullYear() < 1900) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
  }
  const raw = trim(value);
  if (!raw || raw.startsWith('0000-00-00')) return '';
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso && Number(iso[1]) < 1900) return '';
  return raw.slice(0, 10);
}

/** Persist empty optional dates as zero-date (columns are NOT NULL). */
function toMysqlDate(value) {
  return toDateOrEmpty(value) || ZERO_DATE;
}

function as01(value, defaultValue = 1) {
  if (value === true || value === '1' || value === 1) return 1;
  if (value === false || value === '0' || value === 0) return 0;
  if (value == null || value === '') return defaultValue;
  return Number(value) ? 1 : 0;
}

function normalizeDayList(value) {
  if (Array.isArray(value)) {
    return value.map((d) => trim(d)).filter(Boolean).join(', ');
  }
  return trim(value);
}

function mapPromoRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    promo_code: row.promo_code || '',
    promo_description: row.promo_description || '',
    p_c_amount: Number(row.p_c_amount) || 0,
    p_c_discount_type: row.p_c_discount_type || 'pounds_off',
    p_c_course: Number(row.p_c_course) || 0,
    p_c_course_id: Number(row.p_c_course_id) || 0,
    p_c_franchise: Number(row.p_c_franchise) || 0,
    p_c_franchise_id: Number(row.p_c_franchise_id) || 0,
    p_c_location: Number(row.p_c_location) || 0,
    p_c_location_id: Number(row.p_c_location_id) || 0,
    p_c_min_booking: Number(row.p_c_min_booking) || 0,
    p_c_for: row.p_c_for || 'anyone',
    p_c_days: Number(row.p_c_days) || 0,
    p_c_day: row.p_c_day || '',
    p_c_expiry: Number(row.p_c_expiry) || 0,
    p_c_expiry_date: toDateOrEmpty(row.p_c_expiry_date),
    p_c_dates_between: Number(row.p_c_dates_between) || 0,
    p_c_from_date: toDateOrEmpty(row.p_c_from_date),
    p_c_to_date: toDateOrEmpty(row.p_c_to_date),
    p_c_active_between: Number(row.p_c_active_between) || 0,
    p_c_active_from_date: toDateOrEmpty(row.p_c_active_from_date),
    p_c_active_to_date: toDateOrEmpty(row.p_c_active_to_date),
    status: Number(row.status) || 0,
    isDeleted: Number(row.isDeleted) || 0,
    created: row.created,
    updated: row.updated,
  };
}

function normalizePromoBody(body = {}, { forceExpiryOff = false } = {}) {
  const promo_code = trim(body.promo_code).toUpperCase();
  const promo_description = trim(body.promo_description);
  const p_c_amount = Number(body.p_c_amount);
  const p_c_discount_type =
    trim(body.p_c_discount_type) === 'percent_off'
      ? 'percent_off'
      : 'pounds_off';

  // Scope toggles: 1 = all, 0 = particular (legacy DB comment)
  let p_c_course = as01(body.p_c_course, 1);
  let p_c_course_id = Number(body.p_c_course_id) || 0;
  let p_c_franchise = as01(body.p_c_franchise, 1);
  let p_c_franchise_id = Number(body.p_c_franchise_id) || 0;
  let p_c_location = as01(body.p_c_location, 1);
  let p_c_location_id = Number(body.p_c_location_id) || 0;

  // Accept legacy string radio values from add/edit forms
  if (body.p_c_course === 'all_course') {
    p_c_course = 1;
    p_c_course_id = 0;
  } else if (body.p_c_course === '0' || body.p_c_course === 0) {
    p_c_course = 0;
  }
  if (body.p_c_franchise === 'all_franchises') {
    p_c_franchise = 1;
    p_c_franchise_id = 0;
  } else if (body.p_c_franchise === '0' || body.p_c_franchise === 0) {
    p_c_franchise = 0;
  }
  if (body.p_c_location === 'all_locations') {
    p_c_location = 1;
    p_c_location_id = 0;
  } else if (body.p_c_location === '0' || body.p_c_location === 0) {
    p_c_location = 0;
  }

  let p_c_days = as01(body.p_c_days, 1);
  let p_c_day = normalizeDayList(body.p_c_day);
  if (body.p_c_days === 'all' || (Array.isArray(body.p_c_day) && body.p_c_day.length === 7)) {
    p_c_days = 1;
    p_c_day = 'Mon, Tue, Wed, Thu, Fri, Sat, Sun';
  }

  let p_c_dates_between = as01(body.p_c_dates_between, 1);
  let p_c_from_date = toDateOrEmpty(body.p_c_from_date);
  let p_c_to_date = toDateOrEmpty(body.p_c_to_date);
  if (body.p_c_dates_between === 'anydate') {
    p_c_dates_between = 1;
    p_c_from_date = '';
    p_c_to_date = '';
  }

  let p_c_active_between = as01(body.p_c_active_between, 1);
  let p_c_active_from_date = toDateOrEmpty(body.p_c_active_from_date);
  let p_c_active_to_date = toDateOrEmpty(body.p_c_active_to_date);
  if (body.p_c_active_between === 'always') {
    p_c_active_between = 1;
    p_c_active_from_date = '';
    p_c_active_to_date = '';
  }

  // Legacy UI for expiry is dead — always force never-expiry on create/update
  // to match add_promo.php / edit_promo.php ($p_c_expiry = 0).
  let p_c_expiry = forceExpiryOff ? 0 : as01(body.p_c_expiry, 0);
  let p_c_expiry_date = forceExpiryOff ? '' : toDateOrEmpty(body.p_c_expiry_date);
  if (forceExpiryOff || body.p_c_expiry === 'never' || body.p_c_expiry === 'ondate') {
    p_c_expiry = 0;
    p_c_expiry_date = '';
  }

  return {
    promo_code,
    promo_description,
    p_c_amount,
    p_c_discount_type,
    p_c_course,
    p_c_course_id: p_c_course === 1 ? 0 : p_c_course_id,
    p_c_franchise,
    p_c_franchise_id: p_c_franchise === 1 ? 0 : p_c_franchise_id,
    p_c_location,
    p_c_location_id: p_c_location === 1 ? 0 : p_c_location_id,
    p_c_min_booking: Number(body.p_c_min_booking) || 0,
    p_c_for: trim(body.p_c_for) === 'ex_cust' ? 'ex_cust' : 'anyone',
    p_c_days,
    p_c_day,
    p_c_expiry,
    p_c_expiry_date,
    p_c_dates_between,
    p_c_from_date,
    p_c_to_date,
    p_c_active_between,
    p_c_active_from_date,
    p_c_active_to_date,
  };
}

function validatePromoFields(fields) {
  if (!fields.promo_code) {
    return { ok: false, message: 'Promo code is required' };
  }
  if (!fields.promo_description) {
    return { ok: false, message: 'Promo description is required' };
  }
  if (!Number.isFinite(fields.p_c_amount) || fields.p_c_amount < 0) {
    return { ok: false, message: 'Discount amount is required' };
  }
  if (
    fields.p_c_discount_type === 'percent_off' &&
    fields.p_c_amount >= 100
  ) {
    return { ok: false, message: 'Percent off must be less than 100' };
  }
  if (fields.p_c_course === 0 && !fields.p_c_course_id) {
    return { ok: false, message: 'Please select a course' };
  }
  if (fields.p_c_franchise === 0 && !fields.p_c_franchise_id) {
    return { ok: false, message: 'Please select a franchise' };
  }
  if (fields.p_c_location === 0 && !fields.p_c_location_id) {
    return { ok: false, message: 'Please select a location' };
  }
  if (fields.p_c_days === 0 && !fields.p_c_day) {
    return { ok: false, message: 'Please select at least one day' };
  }
  if (
    fields.p_c_dates_between === 0 &&
    (!fields.p_c_from_date || !fields.p_c_to_date)
  ) {
    return { ok: false, message: 'Please select from and to dates' };
  }
  if (
    fields.p_c_active_between === 0 &&
    (!fields.p_c_active_from_date || !fields.p_c_active_to_date)
  ) {
    return { ok: false, message: 'Please select active from and to dates' };
  }
  return { ok: true };
}

async function getPromoFormOptions(pool) {
  // Match legacy general.class.php option loaders:
  // courses: isDeleted + status 1|2; franchise: isDeleted + status 1;
  // locations: status only (no isDeleted column).
  const [courses] = await pool.query(
    `SELECT id, course_name FROM courses
     WHERE isDeleted = '0' AND status IN ('1', '2')
     ORDER BY course_name ASC`
  );
  const [franchises] = await pool.query(
    `SELECT id, franchise_name FROM franchise
     WHERE isDeleted = '0' AND status = '1'
     ORDER BY franchise_name ASC`
  );
  const [locations] = await pool.query(
    `SELECT id, location_name FROM locations
     WHERE status = '1'
     ORDER BY location_name ASC`
  );

  return {
    courses: (courses || []).map((c) => ({
      id: c.id,
      label: c.course_name,
    })),
    franchises: (franchises || []).map((f) => ({
      id: f.id,
      label: f.franchise_name,
    })),
    locations: (locations || []).map((l) => ({
      id: l.id,
      label: l.location_name,
    })),
    discountTypes: [
      { value: 'pounds_off', label: 'Pounds off' },
      { value: 'percent_off', label: 'Percent off' },
    ],
    forOptions: [
      { value: 'anyone', label: 'Anyone' },
      { value: 'ex_cust', label: 'Existing customers' },
    ],
    dayOptions: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  };
}

async function listPromos(pool, { page = 1, searchterm = {} } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const offset = (pageNum - 1) * RECORDS_PER_PAGE;
  const nameScr = trim(searchterm.name_scr);

  let where = 'WHERE isDeleted = 0';
  const params = [];
  if (nameScr) {
    where += ' AND (promo_code LIKE ? OR promo_description LIKE ?)';
    params.push(`%${nameScr}%`, `%${nameScr}%`);
  }

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM promos ${where}`,
    params
  );
  const total = Number(countRows?.[0]?.total) || 0;

  const [rows] = await pool.query(
    `SELECT * FROM promos ${where} ORDER BY promo_code ASC LIMIT ?, ?`,
    [...params, offset, RECORDS_PER_PAGE]
  );

  return {
    items: (rows || []).map(mapPromoRow),
    pagination: {
      page: pageNum,
      perPage: RECORDS_PER_PAGE,
      total,
      totalPages: Math.max(1, Math.ceil(total / RECORDS_PER_PAGE)),
    },
    filters: { name_scr: nameScr },
  };
}

async function getPromoById(pool, id) {
  const promoId = Number(id);
  if (!Number.isFinite(promoId) || promoId <= 0) return null;
  const [rows] = await pool.query('SELECT * FROM promos WHERE id = ? LIMIT 1', [
    promoId,
  ]);
  return mapPromoRow(rows?.[0]);
}

async function createPromo(pool, body = {}) {
  const fields = normalizePromoBody(body, { forceExpiryOff: true });
  const validation = validatePromoFields(fields);
  if (!validation.ok) return validation;

  const [dup] = await pool.query(
    'SELECT id FROM promos WHERE promo_code = ? LIMIT 1',
    [fields.promo_code]
  );
  if (dup?.length) {
    return {
      ok: false,
      message: 'Another promo code already exists with same promo code',
    };
  }

  const created = nowMysql();
  const [result] = await pool.query(
    `INSERT INTO promos (
       promo_code, promo_description, p_c_amount, p_c_discount_type,
       p_c_course, p_c_course_id, p_c_franchise, p_c_franchise_id,
       p_c_location, p_c_location_id, p_c_min_booking, p_c_for,
       p_c_days, p_c_day, p_c_expiry, p_c_expiry_date,
       p_c_dates_between, p_c_from_date, p_c_to_date,
       p_c_active_between, p_c_active_from_date, p_c_active_to_date,
       status, isDeleted, created, updated
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
    [
      fields.promo_code,
      fields.promo_description,
      fields.p_c_amount,
      fields.p_c_discount_type,
      fields.p_c_course,
      fields.p_c_course_id,
      fields.p_c_franchise,
      fields.p_c_franchise_id,
      fields.p_c_location,
      fields.p_c_location_id,
      fields.p_c_min_booking,
      fields.p_c_for,
      fields.p_c_days,
      fields.p_c_day,
      fields.p_c_expiry,
      toMysqlDate(fields.p_c_expiry_date),
      fields.p_c_dates_between,
      toMysqlDate(fields.p_c_from_date),
      toMysqlDate(fields.p_c_to_date),
      fields.p_c_active_between,
      toMysqlDate(fields.p_c_active_from_date),
      toMysqlDate(fields.p_c_active_to_date),
      created,
      created,
    ]
  );

  return {
    ok: true,
    message: 'Promo Code added successfully',
    data: { id: result.insertId },
  };
}

async function updatePromo(pool, id, body = {}) {
  const promoId = Number(id);
  if (!Number.isFinite(promoId) || promoId <= 0) {
    return { ok: false, message: 'Promo code not found to edit' };
  }

  const existing = await getPromoById(pool, promoId);
  if (!existing || existing.isDeleted === 1) {
    return { ok: false, message: 'Promo code not found to edit' };
  }

  const fields = normalizePromoBody(body, { forceExpiryOff: true });
  const validation = validatePromoFields(fields);
  if (!validation.ok) return validation;

  const [dup] = await pool.query(
    'SELECT id FROM promos WHERE promo_code = ? AND id != ? LIMIT 1',
    [fields.promo_code, promoId]
  );
  if (dup?.length) {
    return {
      ok: false,
      message: 'Another promo code already exists with same promo code',
    };
  }

  const [result] = await pool.query(
    `UPDATE promos SET
       promo_code = ?, promo_description = ?, p_c_amount = ?, p_c_discount_type = ?,
       p_c_course = ?, p_c_course_id = ?, p_c_min_booking = ?, p_c_for = ?,
       p_c_days = ?, p_c_day = ?, p_c_expiry = ?, p_c_expiry_date = ?,
       p_c_dates_between = ?, p_c_from_date = ?, p_c_to_date = ?,
       p_c_franchise = ?, p_c_franchise_id = ?, p_c_location = ?, p_c_location_id = ?,
       p_c_active_between = ?, p_c_active_from_date = ?, p_c_active_to_date = ?,
       status = 1, updated = ?
     WHERE id = ?`,
    [
      fields.promo_code,
      fields.promo_description,
      fields.p_c_amount,
      fields.p_c_discount_type,
      fields.p_c_course,
      fields.p_c_course_id,
      fields.p_c_min_booking,
      fields.p_c_for,
      fields.p_c_days,
      fields.p_c_day,
      fields.p_c_expiry,
      toMysqlDate(fields.p_c_expiry_date),
      fields.p_c_dates_between,
      toMysqlDate(fields.p_c_from_date),
      toMysqlDate(fields.p_c_to_date),
      fields.p_c_franchise,
      fields.p_c_franchise_id,
      fields.p_c_location,
      fields.p_c_location_id,
      fields.p_c_active_between,
      toMysqlDate(fields.p_c_active_from_date),
      toMysqlDate(fields.p_c_active_to_date),
      nowMysql(),
      promoId,
    ]
  );

  if (!result?.affectedRows) {
    return { ok: false, message: 'Error in updating promo code' };
  }

  return { ok: true, message: 'Promo Code edited successfully' };
}

async function updatePromoStatus(pool, id, status) {
  const promoId = Number(id);
  if (!Number.isFinite(promoId) || promoId <= 0) {
    return { ok: false, message: 'Promo code not found' };
  }

  const nextStatus = Number(status);
  if (nextStatus !== 0 && nextStatus !== 1) {
    return { ok: false, message: 'Invalid status' };
  }

  const [existing] = await pool.query(
    'SELECT id FROM promos WHERE id = ? AND isDeleted = 0 LIMIT 1',
    [promoId]
  );
  if (!existing?.length) {
    return { ok: false, message: 'Promo code not found' };
  }

  await pool.query('UPDATE promos SET status = ?, updated = ? WHERE id = ?', [
    nextStatus,
    nowMysql(),
    promoId,
  ]);

  return { ok: true, message: 'Status updated successfully' };
}

async function softDeletePromo(pool, id) {
  const promoId = Number(id);
  if (!Number.isFinite(promoId) || promoId <= 0) {
    return { ok: false, message: 'Promo code not found to delete' };
  }

  const [existing] = await pool.query(
    'SELECT id FROM promos WHERE id = ? LIMIT 1',
    [promoId]
  );
  if (!existing?.length) {
    return { ok: false, message: 'Promo code not found to delete' };
  }

  await pool.query(
    'UPDATE promos SET isDeleted = 1, status = 0, updated = ? WHERE id = ?',
    [nowMysql(), promoId]
  );

  return { ok: true, message: 'Promo code deleted successfully' };
}

module.exports = {
  listPromos,
  getPromoById,
  createPromo,
  updatePromo,
  updatePromoStatus,
  softDeletePromo,
  getPromoFormOptions,
  RECORDS_PER_PAGE,
};
