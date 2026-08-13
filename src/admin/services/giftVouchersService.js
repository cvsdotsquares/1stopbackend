/**
 * Admin gift vouchers — port of legacy gift_voucher/* + MOTO gift payment flow.
 *
 * Voucher ref format (legacy giftVoucherRefNo):
 *   `{inv_prefix|1SGV}{bid} - MGV|TGV|OGV|WGV`
 *
 * Ref number source: we INSERT a placeholder `bookings` row
 * (`booking_made_by='gift_voucher'`) to claim a stable AUTO_INCREMENT id,
 * matching the public giftVoucher controller. Legacy PHP bumped
 * information_schema AUTO_INCREMENT without inserting — that race is unsafe,
 * so the placeholder-row approach is intentional.
 */
const { phpSerialize } = require('../../utils/phpSerialize');
const { sendGiftVoucherEmail } = require('../../utils/emailService');
const {
  createAccessHostedPayment,
  getAdminFrontendBase,
  getApiPublicBase,
  getWorldpayCurrency,
  getWorldpayPurchaseUrl,
  getWorldpayTestMode,
  formatWorldpayAmount,
  buildWorldpaySignature,
  resolveMotoWorldpayCredentials,
  resolveMotoIntegrationMode,
  isMockMode,
  hasAccessCredentials,
  getMotoHppCustomisationId,
  pickCallbackField,
} = require('./motoPaymentService');

const RECORDS_PER_PAGE = 10;

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function nowMysql() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function formatVoucherDate(value) {
  if (!value) {
    return new Date().toLocaleDateString('en-GB');
  }
  const raw = trim(value);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function giftVoucherRefNo(prefix, bid, paymentType) {
  const suffix =
    paymentType === 'o'
      ? 'OGV'
      : paymentType === 'm'
        ? 'MGV'
        : paymentType === 'w'
          ? 'WGV'
          : 'TGV';
  const base = trim(prefix) || '1SGV';
  return `${base}${bid} - ${suffix}`;
}

function paymentTypeLabel(voucherPaymentType) {
  if (voucherPaymentType === 'o') return 'Online';
  if (voucherPaymentType === 'm') return 'MOTO';
  if (voucherPaymentType === 'w') return 'Worldpay';
  return 'Terminal';
}

function mapVoucherRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    bid: row.bid,
    voucher_ref: row.voucher_ref || '',
    voucher_date: row.voucher_date || '',
    subject: row.subject || '',
    voucher_person: row.voucher_person || '',
    voucher_free_text: row.voucher_free_text || '',
    voucher_value: Number(row.voucher_value) || 0,
    purchased_by: row.purchased_by || '',
    voucher_contact: row.voucher_contact || '',
    voucher_email: row.voucher_email || '',
    voucher_payement_type: row.voucher_payement_type || '',
    template_id: row.template_id,
    franchise_to_paid: Number(row.franchise_to_paid) || 0,
    user_id: Number(row.user_id) || 0,
    status: Number(row.status) || 0,
    redeemed: row.redeemed || 'No',
    redeem_note: row.redeem_note || '',
    created: row.created,
  };
}

function buildSearchWhere(baseWhere, nameScr, { includeRedeemNote = false } = {}) {
  const whereParts = [baseWhere];
  const params = [];
  const q = trim(nameScr);
  if (q) {
    const like = `%${q}%`;
    const fields = [
      'gift_voucher.subject',
      'gift_voucher.voucher_free_text',
      'gift_voucher.voucher_value',
      'gift_voucher.purchased_by',
      'gift_voucher.voucher_contact',
      'gift_voucher.voucher_email',
      'gift_voucher.voucher_ref',
    ];
    if (includeRedeemNote) fields.push('gift_voucher.redeem_note');
    whereParts.push(`(${fields.map((f) => `${f} LIKE ?`).join(' OR ')})`);
    for (let i = 0; i < fields.length; i += 1) params.push(like);
  }
  return { where: `WHERE ${whereParts.join(' AND ')}`, params };
}

async function listGiftVouchers(
  pool,
  { page = 1, searchterm = {}, redeemed = 'No' } = {}
) {
  const pageNum = Math.max(1, Number(page) || 1);
  const offset = (pageNum - 1) * RECORDS_PER_PAGE;
  const redeemedFlag = redeemed === 'Yes' ? 'Yes' : 'No';
  const { where, params } = buildSearchWhere(
    `gift_voucher.redeemed = ?`,
    searchterm.name_scr,
    { includeRedeemNote: redeemedFlag === 'Yes' }
  );
  const allParams = [redeemedFlag, ...params];

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM gift_voucher ${where}`,
    allParams
  );
  const total = Number(countRows?.[0]?.total) || 0;

  const [rows] = await pool.query(
    `SELECT * FROM gift_voucher ${where} ORDER BY id DESC LIMIT ?, ?`,
    [...allParams, offset, RECORDS_PER_PAGE]
  );

  return {
    items: (rows || []).map(mapVoucherRow),
    pagination: {
      page: pageNum,
      perPage: RECORDS_PER_PAGE,
      total,
      totalPages: Math.max(1, Math.ceil(total / RECORDS_PER_PAGE)),
    },
    filters: {
      name_scr: trim(searchterm.name_scr),
      redeemed: redeemedFlag,
    },
  };
}

async function getGiftVoucherById(pool, id) {
  const voucherId = Number(id);
  if (!Number.isFinite(voucherId) || voucherId <= 0) return null;
  const [rows] = await pool.query(
    'SELECT * FROM gift_voucher WHERE id = ? LIMIT 1',
    [voucherId]
  );
  return mapVoucherRow(rows?.[0]);
}

async function getFranchiseForVoucher(pool, franchiseId) {
  const id = Number(franchiseId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const [rows] = await pool.query(
    `SELECT id, franchise_name, inv_prefix, payment_directly, inst_id, acc_id,
            telephone, freephone, franchise_email, website,
            franchise_address1, franchise_address2, franchise_address3,
            franchise_address4, franchise_postcode
     FROM franchise
     WHERE id = ? AND isDeleted = '0'
     LIMIT 1`,
    [id]
  );
  return rows?.[0] || null;
}

async function getVoucherFormOptions(pool) {
  const [franchises] = await pool.query(
    `SELECT id, franchise_name, inv_prefix, payment_directly
     FROM franchise
     WHERE isDeleted = '0' AND status = '1' AND payment_directly = '1'
     ORDER BY franchise_name ASC`
  );

  let giftOptions = [];
  try {
    const [opts] = await pool.query(
      `SELECT gift_option FROM gift_voucher_options
       WHERE voucher_template_id = 1
       ORDER BY id ASC`
    );
    giftOptions = (opts || [])
      .map((o) => trim(o.gift_option))
      .filter(Boolean);
  } catch (_err) {
    // table may be empty / missing on some envs
  }

  if (!giftOptions.length) {
    const [temps] = await pool.query(
      'SELECT gift_option FROM voucher_templates WHERE id = 1 LIMIT 1'
    );
    const raw = trim(temps?.[0]?.gift_option);
    if (raw) {
      giftOptions = raw
        .split(',')
        .map((s) => trim(s))
        .filter(Boolean);
    }
  }

  return {
    franchises: (franchises || []).map((f) => ({
      id: f.id,
      franchise_name: f.franchise_name,
      inv_prefix: f.inv_prefix || '',
    })),
    gift_options: giftOptions,
    payment_types: [
      { value: 't', label: 'Terminal (payment received)' },
      { value: 'm', label: 'MOTO' },
    ],
  };
}

async function getVoucherTemplate(pool) {
  const [rows] = await pool.query(
    'SELECT * FROM voucher_templates WHERE id = 1 LIMIT 1'
  );
  const row = rows?.[0];
  if (!row) {
    return { id: 1, details: '', gift_option: '', options: [] };
  }

  let options = [];
  try {
    const [opts] = await pool.query(
      `SELECT id, gift_option FROM gift_voucher_options
       WHERE voucher_template_id = ?
       ORDER BY id ASC`,
      [row.id]
    );
    options = (opts || []).map((o) => ({
      id: o.id,
      gift_option: o.gift_option,
    }));
  } catch (_err) {
    // ignore
  }

  return {
    id: row.id,
    details: row.details || '',
    gift_option: row.gift_option || '',
    options,
  };
}

async function updateVoucherTemplate(pool, body = {}) {
  const details = body.details != null ? String(body.details) : '';
  const gift_option = trim(body.gift_option);
  const id = Number(body.id) || 1;

  const [existing] = await pool.query(
    'SELECT id FROM voucher_templates WHERE id = ? LIMIT 1',
    [id]
  );

  if (existing?.length) {
    await pool.query(
      'UPDATE voucher_templates SET details = ?, gift_option = ? WHERE id = ?',
      [details, gift_option, id]
    );
  } else {
    await pool.query(
      'INSERT INTO voucher_templates (id, details, gift_option) VALUES (?, ?, ?)',
      [id, details, gift_option]
    );
  }

  try {
    await pool.query(
      'DELETE FROM gift_voucher_options WHERE voucher_template_id = ?',
      [id]
    );
    if (gift_option) {
      const options = [
        ...new Set(
          gift_option
            .split(',')
            .map((s) => trim(s))
            .filter(Boolean)
        ),
      ];
      for (const option of options) {
        await pool.query(
          'INSERT INTO gift_voucher_options (gift_option, voucher_template_id) VALUES (?, ?)',
          [option, id]
        );
      }
    }
  } catch (_err) {
    // gift_voucher_options may not exist on all DBs
  }

  return {
    ok: true,
    message: 'Template edited successfully',
    data: await getVoucherTemplate(pool),
  };
}

function validateCreateBody(body = {}) {
  const required = [
    'subject',
    'voucher_person',
    'voucher_value',
    'purchased_by',
    'voucher_contact',
    'voucher_email',
  ];
  for (const key of required) {
    if (!trim(body[key])) {
      return {
        ok: false,
        message: 'Required fields mark with * can not be left blank',
      };
    }
  }
  const amount = Number(body.voucher_value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, message: 'Enter a valid voucher value greater than zero' };
  }
  return { ok: true };
}

async function insertPlaceholderBooking(connection, { userId = 0, typeOfBook, amount }) {
  const created = nowMysql();
  const [bookingInsert] = await connection.query(
    `INSERT INTO bookings
     (course_id, course_event_id, user_id, type_of_book, spaces, payment_due,
      total_fees, vatrate, vat, total_amount, admin_payment_received, status,
      lockid, edit_payment_type, edited_booking_id, created_by, booking_made_by,
      created, modified)
     VALUES (0, 0, ?, ?, 0, ?, 0, 0, 0, ?, 0, 0, 0, '', 0, 0, 'gift_voucher', ?, ?)`,
    [userId || 0, typeOfBook, amount, amount, created, created]
  );
  return bookingInsert.insertId;
}

async function insertGiftVoucherRow(connection, fields) {
  const [result] = await connection.query(
    `INSERT INTO gift_voucher
     (bid, voucher_ref, voucher_date, subject, voucher_free_text, voucher_value,
      purchased_by, voucher_contact, voucher_email, voucher_payement_type,
      template_id, created, voucher_person, franchise_to_paid, status, redeem_note, redeemed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, '', 'No')`,
    [
      fields.bid,
      fields.voucher_ref,
      fields.voucher_date,
      fields.subject,
      fields.voucher_free_text,
      fields.voucher_value,
      fields.purchased_by,
      fields.voucher_contact,
      fields.voucher_email,
      fields.voucher_payement_type,
      fields.created,
      fields.voucher_person,
      fields.franchise_to_paid,
      fields.status,
    ]
  );
  return result.insertId;
}

async function insertGiftVoucherPayment(connection, {
  bid,
  voucher_ref,
  voucher_person,
  subject,
  voucher_value,
  franchise_to_paid,
  franchise_name,
  voucher_payement_type,
  transation_id,
  response,
}) {
  const payment_description = `Gift Voucher For ${subject}`;
  const extra = phpSerialize({
    payee_name: voucher_person,
    payment_description,
    franchise: String(franchise_to_paid || 0),
    franchise_name: franchise_name || '',
  });

  await connection.query(
    `INSERT INTO booking_payments
     (transation_id, response, booking_id, payment_type, amount, created,
      transation_type, transation_extra_info, custom_payment_booking_ref, isDelete)
     VALUES (?, ?, ?, ?, ?, ?, 'custom_payment', ?, ?, 0)`,
    [
      transation_id || '',
      typeof response === 'string' ? response : JSON.stringify(response || {}),
      bid,
      paymentTypeLabel(voucher_payement_type),
      voucher_value,
      nowMysql(),
      extra,
      voucher_ref,
    ]
  );
}

async function sendVoucherEmailSafe(pool, voucherId) {
  const voucher = await getGiftVoucherById(pool, voucherId);
  if (!voucher) return { success: false };
  try {
    return await sendGiftVoucherEmail(
      {
        voucher_ref: voucher.voucher_ref,
        voucher_person: voucher.voucher_person,
        voucher_email: voucher.voucher_email,
        subject: voucher.subject,
        voucher_value: voucher.voucher_value,
        voucher_free_text: voucher.voucher_free_text,
        created: voucher.created,
      },
      pool
    );
  } catch (err) {
    console.error('[ADMIN][GIFT_VOUCHERS] email error', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Complete a pending MOTO gift voucher after WorldPay success.
 * Called from motoPaymentService / motoPaymentController.
 */
async function completeGiftVoucherMotoPayment(pool, body = {}, options = {}) {
  const voucherIdRaw = pickCallbackField(body, 'M_voucherId', 'm_voucherid');
  const cartId = pickCallbackField(
    body,
    'cartId',
    'cartid',
    'MC_order_id',
    'transactionReference',
    'ref'
  );
  const transId = pickCallbackField(body, 'transId', 'transid', 'paymentId');
  const transStatus = pickCallbackField(body, 'transStatus', 'transstatus', 'outcome');

  const statusUpper = String(transStatus || '').toUpperCase();
  const authorised =
    options.forceSuccess === true ||
    statusUpper === 'Y' ||
    statusUpper === 'AUTHORIZED' ||
    statusUpper === 'AUTHORISED' ||
    statusUpper === 'SENT_FOR_SETTLEMENT' ||
    statusUpper === 'SUCCESS' ||
    (options.allowMissingStatus && !transStatus && options.forceSuccess !== false);

  if (!authorised) {
    return cancelGiftVoucherMotoPayment(pool, body);
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    let voucher = null;
    if (voucherIdRaw) {
      const [rows] = await connection.query(
        'SELECT * FROM gift_voucher WHERE id = ? LIMIT 1 FOR UPDATE',
        [Number(voucherIdRaw)]
      );
      voucher = rows?.[0] || null;
    }
    if (!voucher && cartId) {
      const [byRef] = await connection.query(
        'SELECT * FROM gift_voucher WHERE voucher_ref = ? LIMIT 1 FOR UPDATE',
        [cartId]
      );
      voucher = byRef?.[0] || null;
      if (!voucher && /^\d+$/.test(cartId)) {
        const [byBid] = await connection.query(
          'SELECT * FROM gift_voucher WHERE bid = ? LIMIT 1 FOR UPDATE',
          [Number(cartId)]
        );
        voucher = byBid?.[0] || null;
      }
    }

    if (!voucher) {
      const err = new Error('Gift voucher not found for MOTO payment');
      err.status = 404;
      throw err;
    }

    if (Number(voucher.status) === 1) {
      await connection.commit();
      return {
        success: true,
        already_completed: true,
        voucher_id: voucher.id,
        order_id: voucher.voucher_ref,
        message: 'Gift voucher payment already recorded',
      };
    }

    const franchise = voucher.franchise_to_paid
      ? await getFranchiseForVoucher(pool, voucher.franchise_to_paid)
      : null;
    const franchiseName = franchise?.franchise_name || '';

    await connection.query(
      'UPDATE gift_voucher SET status = 1 WHERE id = ?',
      [voucher.id]
    );

    await connection.query(
      `UPDATE bookings
       SET status = 1, admin_payment_received = ?, payment_due = 0, modified = ?
       WHERE id = ? AND booking_made_by = 'gift_voucher'`,
      [Number(voucher.voucher_value) || 0, nowMysql(), voucher.bid]
    );

    await insertGiftVoucherPayment(connection, {
      bid: voucher.bid,
      voucher_ref: voucher.voucher_ref,
      voucher_person: voucher.voucher_person,
      subject: voucher.subject,
      voucher_value: voucher.voucher_value,
      franchise_to_paid: voucher.franchise_to_paid,
      franchise_name: franchiseName,
      voucher_payement_type: 'm',
      transation_id: transId || cartId || '',
      response: body,
    });

    const completedId = voucher.id;
    const completedRef = voucher.voucher_ref;
    await connection.commit();

    await sendVoucherEmailSafe(pool, completedId);

    return {
      success: true,
      voucher_id: completedId,
      order_id: completedRef,
      message: 'Gift voucher MOTO payment completed',
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Cancel / abandon unpaid MOTO gift voucher (status=0).
 */
async function cancelGiftVoucherMotoPayment(pool, body = {}) {
  const voucherIdRaw = pickCallbackField(body, 'M_voucherId', 'm_voucherid');
  const cartId = pickCallbackField(
    body,
    'cartId',
    'cartid',
    'MC_order_id',
    'transactionReference',
    'ref'
  );

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    let voucher = null;
    if (voucherIdRaw) {
      const [rows] = await connection.query(
        'SELECT * FROM gift_voucher WHERE id = ? LIMIT 1 FOR UPDATE',
        [Number(voucherIdRaw)]
      );
      voucher = rows?.[0] || null;
    }
    if (!voucher && cartId) {
      const [byRef] = await connection.query(
        'SELECT * FROM gift_voucher WHERE voucher_ref = ? LIMIT 1 FOR UPDATE',
        [cartId]
      );
      voucher = byRef?.[0] || null;
      if (!voucher && /^\d+$/.test(cartId)) {
        const [byBid] = await connection.query(
          'SELECT * FROM gift_voucher WHERE bid = ? LIMIT 1 FOR UPDATE',
          [Number(cartId)]
        );
        voucher = byBid?.[0] || null;
      }
    }

    if (!voucher) {
      await connection.commit();
      return {
        success: true,
        cancelled: true,
        message: 'Gift voucher already removed or not found',
      };
    }

    if (Number(voucher.status) === 1) {
      await connection.commit();
      return {
        success: false,
        cancelled: false,
        already_completed: true,
        voucher_id: voucher.id,
        order_id: voucher.voucher_ref,
        message: 'Gift voucher already paid; cancel ignored',
      };
    }

    await connection.query('DELETE FROM gift_voucher WHERE id = ?', [voucher.id]);
    if (voucher.bid) {
      await connection.query(
        `DELETE FROM bookings
         WHERE id = ? AND booking_made_by = 'gift_voucher' AND status = 0`,
        [voucher.bid]
      );
      await connection.query(
        'DELETE FROM booking_payments WHERE booking_id = ? AND isDelete = 1',
        [voucher.bid]
      );
    }

    await connection.commit();
    return {
      success: true,
      cancelled: true,
      voucher_id: voucher.id,
      order_id: voucher.voucher_ref,
      message: 'Unpaid gift voucher cancelled and removed',
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function findPendingGiftVoucherByRef(pool, ref) {
  const orderRef = trim(ref);
  if (!orderRef) return null;
  const [byRef] = await pool.query(
    `SELECT * FROM gift_voucher
     WHERE voucher_ref = ? AND status = 0
     LIMIT 1`,
    [orderRef]
  );
  if (byRef?.[0]) return byRef[0];
  if (/^\d+$/.test(orderRef)) {
    const [byBid] = await pool.query(
      `SELECT * FROM gift_voucher
       WHERE bid = ? AND status = 0
       LIMIT 1`,
      [Number(orderRef)]
    );
    return byBid?.[0] || null;
  }
  return null;
}

async function initiateGiftVoucherMoto(pool, {
  bid,
  voucherId,
  voucher_ref,
  voucher_value,
  purchased_by,
  voucher_email,
  voucher_contact,
  franchise,
}) {
  const integration = resolveMotoIntegrationMode();
  const apiBase = getApiPublicBase();
  const adminBase = getAdminFrontendBase();
  const currency = getWorldpayCurrency();
  const amount = Number(voucher_value);
  const completeUrl = `${apiBase}/api/admin/payments/moto/complete`;
  const cancelUrl = `${apiBase}/api/admin/payments/moto/cancel`;
  const notifyUrl = `${apiBase}/api/admin/payments/moto/notify`;
  const resultPath = `${adminBase}/admin/gift-vouchers`;

  if (isMockMode()) {
    return {
      mock: true,
      integration: 'mock',
      voucher_id: voucherId,
      booking_id: bid,
      order_id: voucher_ref,
      amount,
      currency,
      result_url: `${resultPath}?moto=success&ref=${encodeURIComponent(voucher_ref)}&mock=1`,
      cancel_url: `${cancelUrl}?status=cancel&cartId=${encodeURIComponent(String(bid))}&M_paymentType=gift_voucher&M_voucherId=${voucherId}`,
      message:
        'WORLDPAY_MOCK_MODE is on — complete via POST /api/admin/payments/moto/mock-complete with the voucher ref.',
    };
  }

  if (integration === 'access_hpp') {
    if (!hasAccessCredentials()) {
      const err = new Error(
        'Access WorldPay credentials are not configured (WORLDPAY_ACCESS_USERNAME / PASSWORD / ENTITY)'
      );
      err.status = 400;
      throw err;
    }

    const { redirectUrl } = await createAccessHostedPayment({
      orderId: voucher_ref,
      amount,
      currency,
      description: `Gift Voucher ${voucher_ref}`,
      payeeName: purchased_by,
      payeeEmail: voucher_email,
      resultUrls: {
        successURL: `${completeUrl}?status=success&cartId=${encodeURIComponent(voucher_ref)}&M_paymentType=gift_voucher&M_voucherId=${voucherId}`,
        cancelURL: `${cancelUrl}?status=cancel&cartId=${encodeURIComponent(voucher_ref)}&M_paymentType=gift_voucher&M_voucherId=${voucherId}`,
        failureURL: `${completeUrl}?status=failed&cartId=${encodeURIComponent(voucher_ref)}&M_paymentType=gift_voucher&M_voucherId=${voucherId}`,
        errorURL: `${completeUrl}?status=failed&cartId=${encodeURIComponent(voucher_ref)}&M_paymentType=gift_voucher&M_voucherId=${voucherId}`,
        pendingURL: `${completeUrl}?status=pending&cartId=${encodeURIComponent(voucher_ref)}&M_paymentType=gift_voucher&M_voucherId=${voucherId}`,
        expiryURL: `${cancelUrl}?status=expiry&cartId=${encodeURIComponent(voucher_ref)}&M_paymentType=gift_voucher&M_voucherId=${voucherId}`,
      },
      options: {
        moto: true,
        customisationId: getMotoHppCustomisationId(),
      },
    });

    return {
      mock: false,
      integration: 'access_hpp',
      voucher_id: voucherId,
      booking_id: bid,
      order_id: voucher_ref,
      amount,
      currency,
      redirect_url: redirectUrl,
      message: 'Redirecting to WorldPay Hosted Payment Pages (gift voucher MOTO)',
    };
  }

  // Payment Pages — cartId is numeric bid (legacy create_gift_voucher.php)
  const { instId, accId } = resolveMotoWorldpayCredentials(franchise);
  const amountStr = formatWorldpayAmount(amount);
  const cartId = String(bid);
  const { signatureFields, signature } = buildWorldpaySignature({
    instId,
    accId,
    amount: amountStr,
    cartId,
    currency,
  });

  const fields = {
    testMode: getWorldpayTestMode(),
    instId,
    cartId,
    amount: amountStr,
    cancelURL: `${cancelUrl}?status=cancel&cartId=${encodeURIComponent(cartId)}`,
    successURL: `${completeUrl}?status=success&cartId=${encodeURIComponent(cartId)}`,
    failureURL: `${completeUrl}?status=failed&cartId=${encodeURIComponent(cartId)}`,
    errorURL: `${completeUrl}?status=failed&cartId=${encodeURIComponent(cartId)}`,
    email: voucher_email,
    name: purchased_by,
    address1: '',
    address2: '',
    address3: '',
    town: '',
    region: '',
    postcode: '',
    country: 'GB',
    currency,
    hideCurrency: 'true',
    desc: '1 Stop Booking',
    accId1: accId,
    tel: voucher_contact || '',
    MC_CancelURL: `${cancelUrl}?status=cancel&cartId=${encodeURIComponent(cartId)}`,
    MC_callback: notifyUrl,
    M_paymentType: 'gift_voucher',
    M_voucherId: String(voucherId),
    signatureFields,
    signature,
  };

  return {
    mock: false,
    integration: 'payment_pages',
    voucher_id: voucherId,
    booking_id: bid,
    order_id: voucher_ref,
    amount,
    currency,
    purchase_url: getWorldpayPurchaseUrl(),
    fields,
    message: 'Redirecting to WorldPay MOTO payment page',
  };
}

async function createGiftVoucher(pool, body = {}) {
  const validation = validateCreateBody(body);
  if (!validation.ok) return validation;

  const paymentTypeRaw = trim(body.payment_type || body.voucher_payement_type).toLowerCase();
  const voucher_payement_type =
    paymentTypeRaw === 'm' || body.motoSubmit ? 'm' : 't';

  const franchiseId = Number(body.franchise_to_paid) || 0;
  let franchise = null;
  let franchise_name = '';
  if (franchiseId > 0) {
    franchise = await getFranchiseForVoucher(pool, franchiseId);
    if (!franchise) {
      return { ok: false, message: 'Franchise not found' };
    }
    franchise_name = franchise.franchise_name || '';
    if (voucher_payement_type === 'm' && String(franchise.payment_directly) !== '1') {
      return {
        ok: false,
        message:
          'This franchise is not enabled for direct / MOTO payments (payment_directly must be Yes)',
      };
    }
  }

  const voucher_value = Number(body.voucher_value);
  const subject = trim(body.subject);
  const voucher_person = trim(body.voucher_person);
  const voucher_free_text = body.voucher_free_text != null ? String(body.voucher_free_text) : '';
  const purchased_by = trim(body.purchased_by);
  const voucher_contact = trim(body.voucher_contact);
  const voucher_email = trim(body.voucher_email);
  const voucher_date = formatVoucherDate(body.voucher_date || body.date);
  const created = nowMysql();

  const connection = await pool.getConnection();
  let voucherId;
  let bid;
  let voucher_ref;

  try {
    await connection.beginTransaction();

    bid = await insertPlaceholderBooking(connection, {
      userId: Number(body.user_id) || 0,
      typeOfBook: voucher_payement_type,
      amount: voucher_value,
    });

    voucher_ref = giftVoucherRefNo(
      franchise?.inv_prefix,
      bid,
      voucher_payement_type
    );

    const status = voucher_payement_type === 'm' ? 0 : 1;

    voucherId = await insertGiftVoucherRow(connection, {
      bid,
      voucher_ref,
      voucher_date,
      subject,
      voucher_free_text,
      voucher_value,
      purchased_by,
      voucher_contact,
      voucher_email,
      voucher_payement_type,
      created,
      voucher_person,
      franchise_to_paid: franchiseId,
      status,
    });

    if (voucher_payement_type === 't') {
      await insertGiftVoucherPayment(connection, {
        bid,
        voucher_ref,
        voucher_person,
        subject,
        voucher_value,
        franchise_to_paid: franchiseId,
        franchise_name,
        voucher_payement_type: 't',
        transation_id: '',
        response: '',
      });

      await connection.query(
        `UPDATE bookings
         SET status = 1, admin_payment_received = ?, payment_due = 0, modified = ?
         WHERE id = ?`,
        [voucher_value, created, bid]
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  if (voucher_payement_type === 't') {
    await sendVoucherEmailSafe(pool, voucherId);
    return {
      ok: true,
      message: 'Gift Voucher added successfully',
      data: {
        id: voucherId,
        bid,
        voucher_ref,
        payment_type: 't',
      },
    };
  }

  // MOTO — start WorldPay after voucher row exists (status=0)
  try {
    if (!franchise) {
      return {
        ok: false,
        message: 'Select a franchise for MOTO gift voucher payment',
      };
    }

    const payment = await initiateGiftVoucherMoto(pool, {
      bid,
      voucherId,
      voucher_ref,
      voucher_value,
      purchased_by,
      voucher_email,
      voucher_contact,
      franchise,
    });

    return {
      ok: true,
      message: payment.message,
      data: {
        id: voucherId,
        bid,
        voucher_ref,
        payment_type: 'm',
        payment,
      },
    };
  } catch (error) {
    // Roll back unpaid voucher if WorldPay setup fails
    await cancelGiftVoucherMotoPayment(pool, {
      M_voucherId: voucherId,
      cartId: String(bid),
    });
    throw error;
  }
}

async function updateGiftVoucher(pool, id, body = {}) {
  const voucherId = Number(id);
  if (!Number.isFinite(voucherId) || voucherId <= 0) {
    return { ok: false, message: 'Gift Voucher not found to edit' };
  }

  const existing = await getGiftVoucherById(pool, voucherId);
  if (!existing) {
    return { ok: false, message: 'Gift Voucher not found to edit' };
  }

  const validation = validateCreateBody({
    subject: body.subject ?? existing.subject,
    voucher_person: body.voucher_person ?? existing.voucher_person,
    voucher_value: body.voucher_value ?? existing.voucher_value,
    purchased_by: body.purchased_by ?? existing.purchased_by,
    voucher_contact: body.voucher_contact ?? existing.voucher_contact,
    voucher_email: body.voucher_email ?? existing.voucher_email,
  });
  if (!validation.ok) return validation;

  const franchise_to_paid =
    body.franchise_to_paid != null
      ? Number(body.franchise_to_paid) || 0
      : existing.franchise_to_paid;

  await pool.query(
    `UPDATE gift_voucher SET
       voucher_date = ?, subject = ?, voucher_free_text = ?, voucher_value = ?,
       purchased_by = ?, voucher_contact = ?, voucher_email = ?,
       voucher_person = ?, redeem_note = ?, franchise_to_paid = ?
     WHERE id = ?`,
    [
      formatVoucherDate(body.voucher_date ?? existing.voucher_date),
      trim(body.subject ?? existing.subject),
      body.voucher_free_text != null
        ? String(body.voucher_free_text)
        : existing.voucher_free_text,
      Number(body.voucher_value ?? existing.voucher_value),
      trim(body.purchased_by ?? existing.purchased_by),
      trim(body.voucher_contact ?? existing.voucher_contact),
      trim(body.voucher_email ?? existing.voucher_email),
      trim(body.voucher_person ?? existing.voucher_person),
      body.redeem_note != null ? String(body.redeem_note) : existing.redeem_note,
      franchise_to_paid,
      voucherId,
    ]
  );

  if (body.resend_email) {
    await sendVoucherEmailSafe(pool, voucherId);
  }

  return { ok: true, message: 'Gift Voucher edited successfully' };
}

async function deleteGiftVoucher(pool, id) {
  const voucherId = Number(id);
  if (!Number.isFinite(voucherId) || voucherId <= 0) {
    return { ok: false, message: 'Gift Voucher not found to delete' };
  }

  const existing = await getGiftVoucherById(pool, voucherId);
  if (!existing) {
    return { ok: false, message: 'Gift Voucher not found to delete' };
  }

  await pool.query('DELETE FROM gift_voucher WHERE id = ?', [voucherId]);
  return { ok: true, message: 'Gift Voucher deleted successfully' };
}

async function getGiftVoucherPrintData(pool, id) {
  const voucher = await getGiftVoucherById(pool, id);
  if (!voucher) return null;

  const template = await getVoucherTemplate(pool);
  let franchise = null;
  if (voucher.franchise_to_paid) {
    franchise = await getFranchiseForVoucher(pool, voucher.franchise_to_paid);
  }

  return {
    voucher,
    template: {
      details: template.details,
      gift_option: template.gift_option,
    },
    franchise: franchise
      ? {
          id: franchise.id,
          franchise_name: franchise.franchise_name,
          telephone: franchise.telephone,
          freephone: franchise.freephone,
          franchise_email: franchise.franchise_email,
          website: franchise.website,
        }
      : null,
  };
}

async function redeemGiftVoucher(pool, id, body = {}) {
  const voucherId = Number(id);
  if (!Number.isFinite(voucherId) || voucherId <= 0) {
    return { ok: false, message: 'Gift Voucher not found to redeem' };
  }

  const existing = await getGiftVoucherById(pool, voucherId);
  if (!existing) {
    return { ok: false, message: 'Gift Voucher not found to redeem' };
  }

  const reinstate =
    body.reinstate === true ||
    body.redeemed === 'No' ||
    trim(body.action).toLowerCase() === 'reinstate';

  if (reinstate) {
    await pool.query(
      `UPDATE gift_voucher SET redeemed = 'No', redeem_note = '' WHERE id = ?`,
      [voucherId]
    );
    return { ok: true, message: 'Gift Voucher reinstate successfully' };
  }

  const redeem_note = trim(body.redeem_note);
  if (!redeem_note) {
    return { ok: false, message: 'Redeem note is required' };
  }

  await pool.query(
    `UPDATE gift_voucher SET redeemed = 'Yes', redeem_note = ? WHERE id = ?`,
    [redeem_note, voucherId]
  );

  return { ok: true, message: 'Gift Voucher redeemed successfully' };
}

module.exports = {
  listGiftVouchers,
  getGiftVoucherById,
  createGiftVoucher,
  updateGiftVoucher,
  deleteGiftVoucher,
  getGiftVoucherPrintData,
  getVoucherTemplate,
  updateVoucherTemplate,
  getVoucherFormOptions,
  getFranchiseForVoucher,
  redeemGiftVoucher,
  completeGiftVoucherMotoPayment,
  cancelGiftVoucherMotoPayment,
  findPendingGiftVoucherByRef,
  giftVoucherRefNo,
  RECORDS_PER_PAGE,
};
