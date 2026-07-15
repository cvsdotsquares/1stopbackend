const fs = require('fs');
const path = require('path');

const RECORDS_PER_PAGE = 10;
const ALLOWED_IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif']);
const FILE_FIELDS = ['email_logo', 'email_header', 'email_footer'];
/** Legacy WorldPay columns — kept empty; payments use Stripe on the customer site. */
const LEGACY_PAYMENT_DEFAULTS = {
  payment_directly: '0',
  merchent_id: '',
  gateway_pass: '',
  pre: '',
  moto_id: '',
  moto_pass: '',
  inst_id: '',
  acc_id: '',
  payment_email: '',
  card_number: '',
  cvv: '',
  cardExpdate: '',
};

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function getFranchiseUploadDir() {
  const base =
    process.env.ADMIN_UPLOADS_DIR ||
    process.env.UPLOAD_DIR ||
    path.join(process.cwd(), 'uploads');
  fs.mkdirSync(base, { recursive: true });
  return base;
}

function getFranchiseUploadBaseUrl(req) {
  const { getSiteUrl } = require('../utils/siteUrl');
  const legacyAdminBase = trim(process.env.LEGACY_ADMIN_URL);
  if (legacyAdminBase) {
    return `${legacyAdminBase.replace(/\/$/, '')}/uploads`;
  }
  const siteUrl = getSiteUrl(req);
  if (siteUrl) {
    return `${siteUrl.replace(/\/$/, '')}/admin/uploads`;
  }
  return '/admin/uploads';
}

function formatAddress(row) {
  const parts = [];
  if (row.franchise_address1) parts.push(row.franchise_address1);
  if (row.franchise_address2) parts.push(row.franchise_address2);
  let line = parts.join(', ');
  if (row.franchise_address3) {
    line = line ? `${line}<br>${row.franchise_address3}` : row.franchise_address3;
  }
  const tail = [row.franchise_address4, row.franchise_postcode].filter(Boolean);
  if (tail.length) {
    const tailStr = tail.join(', ');
    line = line ? `${line}<br>${tailStr}` : tailStr;
  }
  return line;
}

function mapFranchiseListRow(row, uploadsBaseUrl = '/admin/uploads') {
  if (!row) return null;
  const base = uploadsBaseUrl.replace(/\/$/, '');
  return {
    id: row.id,
    franchise_name: row.franchise_name,
    franchise_address1: row.franchise_address1,
    franchise_address2: row.franchise_address2,
    franchise_address3: row.franchise_address3,
    franchise_address4: row.franchise_address4,
    franchise_postcode: row.franchise_postcode,
    address_html: formatAddress(row),
    franchise_owned: String(row.franchise_owned ?? '0'),
    franchise_owned_name: row.franchise_owned_name || '',
    prim_franch: String(row.prim_franch ?? '0'),
    status: String(row.status ?? '0'),
    email_logo: row.email_logo || '',
    email_header: row.email_header || '',
    email_footer: row.email_footer || '',
    email_logo_url: row.email_logo ? `${base}/${row.email_logo}` : null,
    email_header_url: row.email_header ? `${base}/${row.email_header}` : null,
    email_footer_url: row.email_footer ? `${base}/${row.email_footer}` : null,
  };
}

function mapFranchiseDetailRow(row, uploadsBaseUrl = '/admin/uploads') {
  if (!row) return null;
  const list = mapFranchiseListRow(row, uploadsBaseUrl);
  return {
    ...list,
    atb_number: row.atb_number || '',
    franchise_email: row.franchise_email || '',
    register_number: row.register_number || '',
    freephone: row.freephone || '',
    telephone: row.telephone || '',
    website: row.website || '',
    vat: String(row.vat ?? '0'),
    vat_number: row.vat_number || '',
    inv_prefix: row.inv_prefix || '',
    inv_days: String(row.inv_days ?? '0'),
    bank: row.bank || '',
    bank_account: row.bank_account || '',
    sort_code: row.sort_code || '',
    payment_term:
      row.payment_term != null && row.payment_term !== ''
        ? String(row.payment_term)
        : '0',
    status: String(row.status ?? '0'),
    created: row.created,
    isDeleted: row.isDeleted,
  };
}

function buildListWhere(searchterm) {
  let where = " WHERE franchise.id != '' AND franchise.isDeleted = '0' ";
  const params = [];

  const nameScr = trim(searchterm?.name_scr);
  if (nameScr) {
    where += ' AND franchise.franchise_name LIKE ?';
    params.push(`%${nameScr}%`);
  }

  const addScr = trim(searchterm?.add_scr);
  if (addScr) {
    where +=
      ' AND (franchise.franchise_address1 LIKE ? OR franchise.franchise_address2 LIKE ? OR franchise.franchise_address3 LIKE ? OR franchise.franchise_address4 LIKE ? OR franchise.franchise_postcode LIKE ?)';
    const like = `%${addScr}%`;
    params.push(like, like, like, like, like);
  }

  return { where, params };
}

async function getLocationOptions(pool) {
  const [rows] = await pool.query(
    "SELECT id, location_name FROM locations WHERE status = '1' ORDER BY location_name ASC"
  );
  return (rows || []).map((row) => ({
    value: String(row.id),
    label: row.location_name,
  }));
}

async function listFranchises(pool, { page = 1, searchterm = {}, uploadsBaseUrl = '/admin/uploads' } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const { where, params } = buildListWhere(searchterm);
  const offset = (pageNum - 1) * RECORDS_PER_PAGE;

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM franchise ${where}`,
    params
  );
  const total = Number(countRows?.[0]?.total) || 0;

  const [rows] = await pool.query(
    `SELECT franchise.*, locations.location_name AS franchise_owned_name
     FROM franchise
     LEFT JOIN locations ON locations.id = franchise.franchise_owned
     ${where}
     ORDER BY franchise.id DESC
     LIMIT ?, ?`,
    [...params, offset, RECORDS_PER_PAGE]
  );

  return {
    items: (rows || []).map((row) => mapFranchiseListRow(row, uploadsBaseUrl)),
    pagination: {
      page: pageNum,
      perPage: RECORDS_PER_PAGE,
      total,
      totalPages: Math.max(1, Math.ceil(total / RECORDS_PER_PAGE)),
    },
    filters: {
      name_scr: trim(searchterm?.name_scr),
      add_scr: trim(searchterm?.add_scr),
      sort: trim(searchterm?.sort),
    },
    locationOptions: await getLocationOptions(pool),
  };
}

async function getFranchiseRawById(pool, id) {
  const [rows] = await pool.query('SELECT * FROM franchise WHERE id = ? LIMIT 1', [
    id,
  ]);
  return rows?.[0] || null;
}

async function getFranchiseById(pool, id, uploadsBaseUrl = '/admin/uploads') {
  const [rows] = await pool.query(
    `SELECT franchise.*, locations.location_name AS franchise_owned_name
     FROM franchise
     LEFT JOIN locations ON locations.id = franchise.franchise_owned
     WHERE franchise.id = ? LIMIT 1`,
    [id]
  );
  return mapFranchiseDetailRow(rows?.[0], uploadsBaseUrl);
}

async function franchiseExistsActiveById(pool, id) {
  const [rows] = await pool.query(
    "SELECT id, prim_franch, status FROM franchise WHERE id = ? AND isDeleted = '0' LIMIT 1",
    [id]
  );
  return rows?.[0] || null;
}

async function franchiseExistsByName(pool, name, excludeId = null) {
  let sql =
    "SELECT id FROM franchise WHERE franchise_name = ? AND isDeleted = '0'";
  const params = [name];
  if (excludeId != null) {
    sql += ' AND id != ?';
    params.push(excludeId);
  }
  sql += ' LIMIT 1';
  const [rows] = await pool.query(sql, params);
  return Boolean(rows?.length);
}

function validateFranchiseBody(body, isEdit = false) {
  const franchiseName = trim(body.franchise_name);
  const status = trim(body.status);

  if (!franchiseName || status === '') {
    return {
      ok: false,
      message: 'Required fields mark with * can not be left blank',
    };
  }

  let paymentTerm = trim(body.payment_term);
  if (paymentTerm === '') {
    paymentTerm = '0';
  }

  let invDays = trim(body.inv_days);
  if (invDays === '') {
    invDays = '0';
  }

  const data = {
    franchise_name: franchiseName,
    atb_number: trim(body.atb_number),
    franchise_address1: trim(body.franchise_address1),
    franchise_address2: trim(body.franchise_address2),
    franchise_address3: trim(body.franchise_address3),
    franchise_address4: trim(body.franchise_address4),
    franchise_postcode: trim(body.franchise_postcode),
    register_number: trim(body.register_number),
    franchise_owned: trim(body.franchise_owned) || '0',
    freephone: trim(body.freephone),
    telephone: trim(body.telephone),
    franchise_email: trim(body.franchise_email),
    website: trim(body.website),
    vat: String(body.vat ?? '0') === '1' ? '1' : '0',
    vat_number: trim(body.vat_number),
    inv_prefix: trim(body.inv_prefix),
    inv_days: invDays,
    bank: trim(body.bank),
    bank_account: trim(body.bank_account),
    sort_code: trim(body.sort_code),
    payment_term: paymentTerm,
    status: String(status) === '1' ? '1' : '0',
  };

  if (isEdit) {
    data.id = trim(body.id);
    if (!data.id) {
      return {
        ok: false,
        message: 'Franchise not found to edit',
      };
    }
  }

  return { ok: true, data };
}

function saveUploadedFranchiseFile(file, fieldKey) {
  if (!file || !file.originalname) {
    return { ok: true, filename: '' };
  }

  const ext = path.extname(file.originalname).slice(1).toLowerCase();
  if (!ALLOWED_IMAGE_EXT.has(ext)) {
    return {
      ok: false,
      message: `File type is not correct for ${fieldKey}`,
    };
  }

  const filename = `${fieldKey}_${Date.now()}.${ext}`;
  const target = path.join(getFranchiseUploadDir(), filename);
  try {
    fs.writeFileSync(target, file.buffer);
    return { ok: true, filename };
  } catch (_err) {
    return {
      ok: false,
      message: `Error in upload file ${fieldKey}`,
    };
  }
}

function deleteFranchiseUploadFile(filename) {
  if (!filename) return;
  const target = path.join(getFranchiseUploadDir(), filename);
  if (fs.existsSync(target)) {
    fs.unlinkSync(target);
  }
}

function processUploadedFiles(files, existing = {}) {
  const filenames = {
    email_logo: existing.email_logo || '',
    email_header: existing.email_header || '',
    email_footer: existing.email_footer || '',
  };

  for (const fieldKey of FILE_FIELDS) {
    const file = files?.[fieldKey]?.[0];
    if (!file) {
      continue;
    }
    const upload = saveUploadedFranchiseFile(file, fieldKey);
    if (!upload.ok) {
      return upload;
    }
    if (upload.filename) {
      if (filenames[fieldKey] && filenames[fieldKey] !== upload.filename) {
        deleteFranchiseUploadFile(filenames[fieldKey]);
      }
      filenames[fieldKey] = upload.filename;
    }
  }

  return { ok: true, filenames };
}

async function createFranchise(pool, body, files) {
  const validation = validateFranchiseBody(body, false);
  if (!validation.ok) {
    return validation;
  }

  const data = validation.data;
  const exists = await franchiseExistsByName(pool, data.franchise_name);
  if (exists) {
    return {
      ok: false,
      message: 'Franchise already exits with same franchise name',
    };
  }

  const uploadResult = processUploadedFiles(files);
  if (!uploadResult.ok) {
    return uploadResult;
  }

  const created = formatTimestamp();
  const filenames = uploadResult.filenames;
  const legacyPayment = LEGACY_PAYMENT_DEFAULTS;

  try {
    const [result] = await pool.query(
      `INSERT INTO franchise (
        franchise_name, franchise_email, franchise_address1, franchise_address2,
        franchise_address3, franchise_address4, franchise_postcode, telephone,
        freephone, website, merchent_id, gateway_pass, moto_id, pre, bank,
        bank_account, sort_code, inv_prefix, inv_days, vat, vat_number,
        franchise_owned, email_logo, email_header, email_footer, register_number,
        status, created, payment_directly, card_number, cvv, cardExpdate,
        payment_email, payment_term, moto_pass, inst_id, acc_id, atb_number
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.franchise_name,
        data.franchise_email,
        data.franchise_address1,
        data.franchise_address2,
        data.franchise_address3,
        data.franchise_address4,
        data.franchise_postcode,
        data.telephone,
        data.freephone,
        data.website,
        legacyPayment.merchent_id,
        legacyPayment.gateway_pass,
        legacyPayment.moto_id,
        legacyPayment.pre,
        data.bank,
        data.bank_account,
        data.sort_code,
        data.inv_prefix,
        data.inv_days,
        data.vat,
        data.vat_number,
        data.franchise_owned,
        filenames.email_logo,
        filenames.email_header,
        filenames.email_footer,
        data.register_number,
        data.status,
        created,
        legacyPayment.payment_directly,
        legacyPayment.card_number,
        legacyPayment.cvv,
        legacyPayment.cardExpdate,
        legacyPayment.payment_email,
        data.payment_term,
        legacyPayment.moto_pass,
        legacyPayment.inst_id,
        legacyPayment.acc_id,
        data.atb_number,
      ]
    );

    if (!result.insertId) {
      return {
        ok: false,
        message: 'Error in adding franchise',
      };
    }

    return {
      ok: true,
      message: 'Franchise added successfully',
      data: { id: result.insertId },
    };
  } catch (err) {
    console.error('[ADMIN][FRANCHISES][CREATE]', err.message);
    return {
      ok: false,
      message: 'Error in adding franchise',
    };
  }
}

async function updateFranchise(pool, id, body, files) {
  const existingRow = await franchiseExistsActiveById(pool, id);
  if (!existingRow) {
    return {
      ok: false,
      message: 'Franchise not found to edit',
    };
  }

  const validation = validateFranchiseBody({ ...body, id: String(id) }, true);
  if (!validation.ok) {
    return validation;
  }

  const data = validation.data;
  const current = await getFranchiseById(pool, id);
  const rawRow = await getFranchiseRawById(pool, id);
  if (!current || !rawRow) {
    return {
      ok: false,
      message: 'Franchise not found to edit',
    };
  }

  const uploadResult = processUploadedFiles(files, current);
  if (!uploadResult.ok) {
    return uploadResult;
  }

  const filenames = uploadResult.filenames;
  const created = formatTimestamp();

  try {
    const [result] = await pool.query(
      `UPDATE franchise SET
        franchise_name = ?, franchise_email = ?, franchise_address1 = ?, franchise_address2 = ?,
        franchise_address3 = ?, franchise_address4 = ?, franchise_postcode = ?, telephone = ?,
        freephone = ?, website = ?, merchent_id = ?, gateway_pass = ?, moto_id = ?, pre = ?,
        bank = ?, bank_account = ?, sort_code = ?, inv_prefix = ?, inv_days = ?, vat = ?,
        vat_number = ?, franchise_owned = ?, email_logo = ?, email_header = ?, email_footer = ?,
        register_number = ?, status = ?, created = ?, payment_directly = ?, card_number = ?,
        cvv = ?, cardExpdate = ?, payment_email = ?, payment_term = ?, moto_pass = ?,
        inst_id = ?, acc_id = ?, atb_number = ?
       WHERE id = ? AND isDeleted = '0'`,
      [
        data.franchise_name,
        data.franchise_email,
        data.franchise_address1,
        data.franchise_address2,
        data.franchise_address3,
        data.franchise_address4,
        data.franchise_postcode,
        data.telephone,
        data.freephone,
        data.website,
        rawRow.merchent_id || '',
        rawRow.gateway_pass || '',
        rawRow.moto_id || '',
        rawRow.pre || '',
        data.bank,
        data.bank_account,
        data.sort_code,
        data.inv_prefix,
        data.inv_days,
        data.vat,
        data.vat_number,
        data.franchise_owned,
        filenames.email_logo,
        filenames.email_header,
        filenames.email_footer,
        data.register_number,
        data.status,
        created,
        rawRow.payment_directly ?? '0',
        rawRow.card_number || '',
        rawRow.cvv || '',
        rawRow.cardExpdate || '',
        rawRow.payment_email || '',
        data.payment_term,
        rawRow.moto_pass || '',
        rawRow.inst_id || '',
        rawRow.acc_id || '',
        data.atb_number,
        id,
      ]
    );

    if (!result.affectedRows) {
      return {
        ok: false,
        message: 'Error in updating franchise',
      };
    }

    return {
      ok: true,
      message: 'Franchise updated successfully',
    };
  } catch (err) {
    console.error('[ADMIN][FRANCHISES][UPDATE]', err.message);
    return {
      ok: false,
      message: 'Error in updating franchise',
    };
  }
}

async function updateFranchiseStatus(pool, id, status) {
  const normalized = String(status) === '1' ? '1' : '0';
  const existing = await franchiseExistsActiveById(pool, id);
  if (!existing) {
    return {
      ok: false,
      message: 'Franchise not found',
    };
  }

  if (
    normalized === '0' &&
    String(existing.prim_franch) === '1'
  ) {
    return {
      ok: false,
      message:
        'This Franchise is currently the Primary Franchise. If you want to deactivate the status, please choose another Franchise as Primary',
    };
  }

  const [result] = await pool.query(
    "UPDATE franchise SET status = ? WHERE id = ? AND isDeleted = '0'",
    [normalized, id]
  );

  if (!result.affectedRows) {
    return {
      ok: false,
      message: 'Error in change status',
    };
  }

  return {
    ok: true,
    message: 'Franchise status changed successfully',
  };
}

async function softDeleteFranchise(pool, id) {
  const existing = await franchiseExistsActiveById(pool, id);
  if (!existing) {
    return {
      ok: false,
      message: 'Franchise not found to delete',
    };
  }

  const [result] = await pool.query(
    "UPDATE franchise SET isDeleted = '1' WHERE id = ?",
    [id]
  );

  if (!result.affectedRows) {
    return {
      ok: false,
      message: 'Error in deleting franchise',
    };
  }

  return {
    ok: true,
    message: 'Franchise deleted successfully',
  };
}

async function setPrimaryFranchise(pool, id) {
  const existing = await franchiseExistsActiveById(pool, id);
  if (!existing) {
    return { ok: false, message: 'Franchise not found' };
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [updateFranchise] = await connection.query(
      "UPDATE franchise SET prim_franch = CASE WHEN id = ? THEN '1' ELSE '0' END WHERE isDeleted = '0'",
      [id]
    );

    const [updateSettings] = await connection.query(
      'UPDATE settings SET voucher_franchise = ?',
      [id]
    );

    if (!updateFranchise.affectedRows) {
      await connection.rollback();
      return { ok: false, message: 'Error in change position' };
    }

    await connection.commit();
    return { ok: true, message: 'Primary franchise updated successfully' };
  } catch (err) {
    await connection.rollback();
    console.error('[ADMIN][FRANCHISES][SET_PRIMARY]', err.message);
    return { ok: false, message: 'Error in change position' };
  } finally {
    connection.release();
  }
}

async function clearFranchiseFileField(pool, id, { fileName, fieldName }) {
  const allowedFields = new Set(FILE_FIELDS);
  const normalizedField = trim(fieldName);
  const normalizedFile = trim(fileName);

  if (!allowedFields.has(normalizedField)) {
    return { ok: false, message: 'Invalid file field' };
  }

  const existing = await franchiseExistsActiveById(pool, id);
  if (!existing) {
    return { ok: false, message: 'Franchise not found to edit' };
  }

  const [rows] = await pool.query(
    `SELECT ${normalizedField} AS file_value FROM franchise WHERE id = ? LIMIT 1`,
    [id]
  );
  const currentValue = rows?.[0]?.file_value || '';

  if (normalizedFile && currentValue && currentValue !== normalizedFile) {
    return { ok: false, message: 'File not found on record' };
  }

  const [result] = await pool.query(
    `UPDATE franchise SET ${normalizedField} = '' WHERE id = ?`,
    [id]
  );

  if (!result.affectedRows) {
    return { ok: false, message: 'Error clearing file field' };
  }

  if (currentValue) {
    deleteFranchiseUploadFile(currentValue);
  } else if (normalizedFile) {
    deleteFranchiseUploadFile(normalizedFile);
  }

  return { ok: true, message: 'File removed successfully' };
}

module.exports = {
  RECORDS_PER_PAGE,
  getFranchiseUploadDir,
  getFranchiseUploadBaseUrl,
  listFranchises,
  getFranchiseById,
  getLocationOptions,
  createFranchise,
  updateFranchise,
  updateFranchiseStatus,
  softDeleteFranchise,
  setPrimaryFranchise,
  clearFranchiseFileField,
};
