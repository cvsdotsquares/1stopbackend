/**
 * Admin MOTO payments.
 *
 * Default (matches staging legacy): WorldPay Business Gateway Payment Pages
 *   POST https://secure(-test).worldpay.com/wcc/purchase
 *   Decrypted franchise.inst_id + franchise.acc_id
 *
 * Latest (when Access credentials configured): Access Hosted Payment Pages
 *   POST https://(try.)access.worldpay.com/payment_pages
 *   MOTO: threeDS.type=disabled (admin-entered card, no 3DS challenge)
 *
 * Legacy parity: make_a_payment.php → world_pay_moto.php → callbacks.
 */
const crypto = require('crypto');
const { mc_decrypt, mc_decrypt_old } = require('../../utils/universalPassword');
const { phpSerialize } = require('../../utils/phpSerialize');

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function nowMysql() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function getWorldpayPurchaseUrl() {
  const configured = trim(process.env.WORLDPAY_PURCHASE_URL);
  if (configured) return configured;
  // Prefer live URL only when explicitly live; otherwise test (legacy stage behaviour)
  if (isWorldpayLive()) {
    return 'https://secure.worldpay.com/wcc/purchase';
  }
  return 'https://secure-test.worldpay.com/wcc/purchase';
}

/**
 * Legacy does not show Test Mode / Currency on the admin form.
 * They are hidden WorldPay POST fields:
 * - testMode: 100 on secure-test, 0 on live (auto from purchase URL)
 * - currency: always GBP for this product unless overridden
 */
function isWorldpayLive() {
  const url = trim(process.env.WORLDPAY_PURCHASE_URL).toLowerCase();
  if (url.includes('secure-test.worldpay.com')) return false;
  if (url.includes('secure.worldpay.com') && !url.includes('secure-test')) {
    return true;
  }
  return String(process.env.WORLDPAY_LIVE || '').toLowerCase() === 'true';
}

function getWorldpayCurrency() {
  return trim(process.env.WORLDPAY_CURRENCY) || 'GBP';
}

/**
 * WorldPay Payment Pages testMode:
 * - 100 = test (secure-test.worldpay.com)
 * - 0   = live (secure.worldpay.com)
 * Override with WORLDPAY_TEST_MODE when needed.
 */
function getWorldpayTestMode() {
  const explicit = trim(process.env.WORLDPAY_TEST_MODE);
  if (explicit !== '') return explicit;
  return isWorldpayLive() ? '0' : '100';
}

/** Legacy posts whole pounds as "1", not "1.00". Signature must use the same string. */
function formatWorldpayAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return String(amount);
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

function isWorldpayTestEnvironment() {
  if (getWorldpayTestMode() === '100') return true;
  const url = trim(process.env.WORLDPAY_PURCHASE_URL).toLowerCase();
  return url.includes('secure-test.worldpay.com');
}

/**
 * MD5 secret from WorldPay MAI — must match the installation ID sent in the form.
 * Optional WORLDPAY_TEST_MD5_SECRET when test/live installations use different secrets.
 */
function getWorldpayMd5Secret() {
  if (isWorldpayTestEnvironment()) {
    const testSecret = trim(process.env.WORLDPAY_TEST_MD5_SECRET);
    if (testSecret) return testSecret;
  }
  const secret = trim(process.env.WORLDPAY_MD5_SECRET);
  if (!secret) {
    const err = new Error(
      'WORLDPAY_MD5_SECRET is not configured (required for Payment Pages signature)'
    );
    err.status = 500;
    throw err;
  }
  return secret;
}

/** Env-based instId/accId (used for course bookings and test-gateway MOTO). */
function getEnvWorldpayCredentials() {
  const testEnv = isWorldpayTestEnvironment();
  const instId = trim(
    testEnv
      ? process.env.WORLDPAY_INST_ID ||
          process.env.WORLDPAY_BOOKING_INST_ID ||
          process.env.WORLDPAY_TEST_INST_ID
      : process.env.WORLDPAY_BOOKING_INST_ID ||
          process.env.WORLDPAY_INST_ID ||
          process.env.WORLDPAY_LIVE_INST_ID
  );
  const accId = trim(
    testEnv
      ? process.env.WORLDPAY_ACC_ID ||
          process.env.WORLDPAY_BOOKING_ACC_ID ||
          process.env.WORLDPAY_TEST_ACC_ID
      : process.env.WORLDPAY_BOOKING_ACC_ID ||
          process.env.WORLDPAY_ACC_ID ||
          process.env.WORLDPAY_LIVE_ACC_ID
  );
  return { instId, accId };
}

/**
 * MOTO Payment Pages credentials.
 * On secure-test, franchise DB rows often hold live installation IDs — use env test IDs instead.
 */
function resolveMotoWorldpayCredentials(franchise) {
  if (isWorldpayTestEnvironment()) {
    const envCreds = getEnvWorldpayCredentials();
    return {
      instId: envCreds.instId || '1382788',
      accId: envCreds.accId || '1STOPINSTRUCM2',
      source: envCreds.instId && envCreds.accId ? 'env' : 'default_test',
    };
  }

  return {
    instId: decryptLegacyPaymentCredential(franchise.inst_id, 'installation ID'),
    accId: decryptLegacyPaymentCredential(franchise.acc_id, 'account ID'),
    source: 'franchise',
  };
}

/**
 * Legacy MD5 password signature (make_a_payment.php / world_pay_moto.php):
 * md5(secret:instId:accId:amount:GBP:cartId)
 * Form field is named accId1 even though PHP stores it as accId2.
 */
function buildWorldpaySignature({ instId, accId, amount, cartId, currency }) {
  const secret = getWorldpayMd5Secret();
  const currencyCode = currency || getWorldpayCurrency();
  const encValues = [
    secret,
    instId,
    accId,
    amount,
    currencyCode,
    cartId,
  ].join(':');
  return {
    signatureFields: 'instId:amount:currency:cartId',
    signature: crypto.createHash('md5').update(encValues, 'utf8').digest('hex'),
  };
}

function getAccessHppBaseUrl() {
  const configured = trim(process.env.WORLDPAY_ACCESS_HPP_URL);
  if (configured) return configured.replace(/\/$/, '');
  const live = String(process.env.WORLDPAY_ACCESS_LIVE || '').toLowerCase() === 'true';
  return live
    ? 'https://access.worldpay.com'
    : 'https://try.access.worldpay.com';
}

function getApiPublicBase() {
  return (
    trim(process.env.API_PUBLIC_URL) ||
    trim(process.env.SITE_URL) ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
}

function getAdminFrontendBase() {
  return (
    trim(process.env.ADMIN_FRONTEND_URL) ||
    trim(process.env.NEXT_PUBLIC_ADMIN_URL) ||
    (process.env.CORS_ALLOWED_ORIGINS || '')
      .split(',')
      .map((o) => o.trim())
      .find(Boolean) ||
    'http://localhost:3001'
  ).replace(/\/$/, '');
}

function isMockMode() {
  return String(process.env.WORLDPAY_MOCK_MODE || '').toLowerCase() === 'true';
}

function hasAccessCredentials() {
  return Boolean(
    trim(process.env.WORLDPAY_ACCESS_USERNAME) &&
      trim(process.env.WORLDPAY_ACCESS_PASSWORD) &&
      trim(process.env.WORLDPAY_ACCESS_ENTITY)
  );
}

/**
 * payment_pages = classic wcc/purchase (current stage / legacy)
 * access_hpp    = Access Hosted Payment Pages (try/access.worldpay.com/payment_pages)
 * auto          = access_hpp if credentials present, else payment_pages
 */
function resolveIntegrationMode() {
  const mode = trim(process.env.WORLDPAY_INTEGRATION || 'auto').toLowerCase();
  if (mode === 'payment_pages' || mode === 'access_hpp') return mode;
  return hasAccessCredentials() ? 'access_hpp' : 'payment_pages';
}

function buildOrderId(invPrefix, bookingId) {
  const prefix = trim(invPrefix) || '1SRC';
  return `${prefix}${bookingId}`;
}

function defaultPaymentDescription(description) {
  const desc = trim(description);
  return desc || 'Custom Payment';
}

/** Legacy make_a_payment.php → booking_payments.transation_extra_info (PHP serialize). */
function buildMotoTransactionExtraInfo({
  payeeName,
  payeeEmail,
  paymentDescription,
  franchiseId,
  franchiseName,
}) {
  return phpSerialize({
    payee_name: payeeName,
    payee_email: payeeEmail,
    payment_description: paymentDescription,
    franchise: String(franchiseId),
    franchise_name: franchiseName,
  });
}

async function listMotoFranchises(pool) {
  const mock = isMockMode();
  const mode = resolveIntegrationMode();
  const needsInstId = !mock && mode === 'payment_pages';

  const [rows] = await pool.query(
    `SELECT id, franchise_name, inv_prefix, payment_directly, inst_id, acc_id,
            moto_id, merchent_id
     FROM franchise
     WHERE isDeleted = '0'
       AND status = '1'
       AND payment_directly = '1'
       ${needsInstId ? "AND TRIM(IFNULL(inst_id, '')) != ''" : ''}
     ORDER BY franchise_name ASC`
  );

  return (rows || []).map((row) => ({
    id: row.id,
    franchise_name: row.franchise_name,
    inv_prefix: row.inv_prefix || '',
    has_acc_id: Boolean(trim(row.acc_id)),
    has_moto_credentials: Boolean(trim(row.moto_id)),
    has_inst_id: Boolean(trim(row.inst_id)),
  }));
}

function decryptLegacyPaymentCredential(value, fieldName) {
  const raw = trim(value);
  if (!raw) return '';

  // Legacy mc_encrypt format is `${base64(ciphertext)}|${base64(iv)}`.
  // Some historical rows may already contain plaintext IDs.
  if (!raw.includes('|')) return raw;

  const key =
    trim(process.env.ENCRYPTION_KEY) ||
    trim(process.env.UNIVERSAL_PASSWORD_KEY);
  if (!key) {
    const err = new Error(
      `Cannot decrypt WorldPay ${fieldName}: ENCRYPTION_KEY is not configured`
    );
    err.status = 500;
    throw err;
  }

  // PHP `$general->getDecrypted()` → `mc_decrypt_old` (Rijndael-256).
  // Fall back to `mc_decrypt` (AES-256) for any newer re-encrypted rows.
  let decrypted = mc_decrypt_old(raw, key);
  if (decrypted === false) {
    decrypted = mc_decrypt(raw, key);
  }
  if (decrypted === false || !trim(decrypted)) {
    const err = new Error(`Unable to decrypt WorldPay ${fieldName}`);
    err.status = 500;
    throw err;
  }
  return trim(decrypted);
}

async function getFranchiseForMoto(pool, franchiseId) {
  const [rows] = await pool.query(
    `SELECT id, franchise_name, inv_prefix, payment_directly, inst_id, acc_id,
            moto_id, moto_pass, merchent_id, gateway_pass,
            franchise_address1, franchise_address2, franchise_address3,
            franchise_address4, franchise_postcode, telephone
     FROM franchise
     WHERE id = ? AND isDeleted = '0'
     LIMIT 1`,
    [franchiseId]
  );
  return rows?.[0] || null;
}

function toMinorUnits(amount) {
  return Math.round(Number(amount) * 100);
}

function buildAccessHppRiskData(payeeName, payeeEmail) {
  const email = trim(payeeEmail);
  if (!email) return null;

  const riskData = {
    account: { email },
  };

  const parts = String(payeeName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts[0]) {
    riskData.transaction = {
      firstName: parts[0].slice(0, 22),
    };
    if (parts.length > 1) {
      riskData.transaction.lastName = parts.slice(1).join(' ').slice(0, 22);
    }
  }

  return riskData;
}

function formatAccessHppError(data, status) {
  if (!data) return `Access HPP setup failed (${status})`;
  if (Array.isArray(data.validationErrors) && data.validationErrors.length) {
    const details = data.validationErrors
      .map((item) => item.message || item.errorName || JSON.stringify(item))
      .filter(Boolean)
      .join('; ');
    if (details) return details;
  }
  if (typeof data.message === 'string' && data.message) return data.message;
  if (typeof data.errorName === 'string' && data.errorName) return data.errorName;
  if (typeof data.raw === 'string' && data.raw) return data.raw;
  return `Access HPP setup failed (${status})`;
}

/**
 * Access Hosted Payment Pages — POST /payment_pages.
 * MOTO admin flow: disable 3DS (no cardholder challenge) via threeDS.type per HPP API.
 * @see http://worldpay-portal.eu.redocly.app/access/products/hosted-payment-pages/changelog
 */
async function createAccessHostedPayment({
  orderId,
  amount,
  currency,
  description,
  payeeName,
  payeeEmail,
  resultUrls,
  options = {},
}) {
  const username = trim(process.env.WORLDPAY_ACCESS_USERNAME);
  const password = trim(process.env.WORLDPAY_ACCESS_PASSWORD);
  const entity = trim(process.env.WORLDPAY_ACCESS_ENTITY);
  const auth = Buffer.from(`${username}:${password}`).toString('base64');
  const url = `${getAccessHppBaseUrl()}/payment_pages`;
  const minorAmount = toMinorUnits(amount);
  if (!Number.isFinite(minorAmount) || minorAmount <= 0) {
    const err = new Error('Payment amount must be greater than zero');
    err.status = 400;
    throw err;
  }

  const payload = {
    transactionReference: String(orderId),
    merchant: { entity },
    narrative: {
      line1: trim(process.env.WORLDPAY_NARRATIVE || '1 Stop Instruction').slice(
        0,
        24
      ),
    },
    value: {
      currency,
      amount: minorAmount,
    },
    resultURLs: resultUrls,
  };

  const disable3ds =
    options.disable3ds !== false &&
    String(process.env.WORLDPAY_HPP_DISABLE_3DS || 'true').toLowerCase() !==
      'false';
  if (disable3ds) {
    payload.threeDS = { type: 'disabled' };
  }

  const disableFraud =
    options.disableFraud !== false &&
    String(process.env.WORLDPAY_HPP_DISABLE_FRAUD || 'true').toLowerCase() !==
      'false';
  if (disableFraud) {
    payload.fraud = { type: 'disabled' };
  }

  const descriptionText = trim(description);
  if (descriptionText) {
    payload.description = descriptionText.slice(0, 128);
  }

  const riskData = buildAccessHppRiskData(payeeName, payeeEmail);
  if (riskData) {
    payload.riskData = riskData;
  }

  const correlationId = crypto.randomUUID();

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/vnd.worldpay.payment_pages-v1.hal+json',
      Accept: 'application/vnd.worldpay.payment_pages-v1.hal+json',
      'WP-CorrelationId': correlationId,
      'User-Agent': '1stopAdmin/1.0',
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const message = formatAccessHppError(data, response.status);
    const err = new Error(message);
    err.status = 502;
    err.details = { ...data, correlationId };
    throw err;
  }

  const redirectUrl = data?.url;
  if (!redirectUrl) {
    const err = new Error('Access HPP response did not include a redirect url');
    err.status = 502;
    err.details = { ...data, correlationId };
    throw err;
  }

  return { redirectUrl, raw: data, correlationId };
}

/**
 * Classic Business Gateway form fields — mirrors world_pay_moto.php POST body.
 */
function buildPaymentPagesFields({
  franchise,
  amount,
  payeeName,
  payeeEmail,
  notifyUrl,
  completeUrl,
  cancelUrl,
  bookingId,
}) {
  const { instId: installationId, accId: accountId } =
    resolveMotoWorldpayCredentials(franchise);
  const currency = getWorldpayCurrency();
  const amountStr = formatWorldpayAmount(amount);
  const cartId = String(bookingId);
  const successURL = `${completeUrl}?status=success&cartId=${encodeURIComponent(bookingId)}`;
  const failureURL = `${completeUrl}?status=failed&cartId=${encodeURIComponent(bookingId)}`;
  const errorURL = `${completeUrl}?status=failed&cartId=${encodeURIComponent(bookingId)}`;
  const cancelURL = `${cancelUrl}?status=cancel&cartId=${encodeURIComponent(bookingId)}`;
  const { signatureFields, signature } = buildWorldpaySignature({
    instId: installationId,
    accId: accountId,
    amount: amountStr,
    cartId,
    currency,
  });

  // Address/tel left blank for custom MOTO (make_a_payment.php sets empty strings).
  return {
    testMode: getWorldpayTestMode(),
    instId: installationId,
    cartId,
    amount: amountStr,
    cancelURL,
    successURL,
    failureURL,
    errorURL,
    email: payeeEmail,
    name: payeeName,
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
    // Form posts accId1; PHP only stores the value under accId2.
    accId1: accountId,
    tel: '',
    MC_CancelURL: cancelURL,
    MC_callback: notifyUrl,
    M_paymentType: 'custom_moto_payment',
    M_voucherId: '0',
    signatureFields,
    signature,
  };
}

/**
 * Create placeholder booking + pending payment, return WorldPay redirect payload.
 */
async function initiateMotoPayment(pool, body, adminSession) {
  const amount = Number(body.make_payment_amount);
  const payeeName = trim(body.payee_name);
  const payeeEmail = trim(body.payee_email);
  const description = defaultPaymentDescription(body.payment_description);
  const franchiseId = Number(body.franchise_to_paid);

  if (!Number.isFinite(amount) || amount <= 0) {
    const err = new Error('Enter a valid payment amount greater than zero');
    err.status = 400;
    throw err;
  }
  if (!payeeName) {
    const err = new Error('Payee Name is required');
    err.status = 400;
    throw err;
  }
  if (!payeeEmail) {
    const err = new Error('Payee Email is required');
    err.status = 400;
    throw err;
  }
  if (!trim(body.payment_description)) {
    const err = new Error('Payment relates to or Order Description is required');
    err.status = 400;
    throw err;
  }
  if (!Number.isFinite(franchiseId) || franchiseId <= 0) {
    const err = new Error('Select a Merchant / franchise');
    err.status = 400;
    throw err;
  }

  const franchise = await getFranchiseForMoto(pool, franchiseId);
  if (!franchise) {
    const err = new Error('Franchise not found');
    err.status = 404;
    throw err;
  }
  if (String(franchise.payment_directly) !== '1') {
    const err = new Error(
      'This franchise is not enabled for direct / MOTO payments (payment_directly must be Yes)'
    );
    err.status = 400;
    throw err;
  }

  const integration = resolveIntegrationMode();
  if (!isMockMode() && integration === 'payment_pages' && !trim(franchise.inst_id)) {
    const err = new Error(
      'Franchise is missing WorldPay installation ID (inst_id).'
    );
    err.status = 400;
    throw err;
  }
  if (!isMockMode() && integration === 'access_hpp' && !hasAccessCredentials()) {
    const err = new Error(
      'Access WorldPay credentials are not configured (WORLDPAY_ACCESS_USERNAME / PASSWORD / ENTITY)'
    );
    err.status = 400;
    throw err;
  }

  const created = nowMysql();
  const adminId =
    adminSession?.loggedinAdmin?.id ||
    adminSession?.loggedinAdmin?.admin_id ||
    adminSession?.admin ||
    0;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [bookingInsert] = await connection.query(
      `INSERT INTO bookings
       (course_id, course_event_id, user_id, booking_made_by_id, booking_made_by,
        type_of_book, spaces, payment_due, total_fees, vatrate, vat, total_amount,
        admin_payment_received, status, lockid, edit_payment_type, edited_booking_id,
        created_by, created, modified)
       VALUES (0, 0, 0, ?, 'moto', 'm', 0, ?, 0, 0, 0, ?, 0, 0, 0, '', 0, ?, ?, ?)`,
      [adminId || 0, amount, amount, adminId || 0, created, created]
    );

    const bookingId = bookingInsert.insertId;
    const orderId = buildOrderId(franchise.inv_prefix, bookingId);

    const pendingPayload = {
      type: 'moto_custom_payment',
      orderId,
      franchise_id: franchise.id,
      payee_name: payeeName,
      payee_email: payeeEmail,
      payment_description: description,
      amount,
      integration,
      status: 'pending',
    };

    const transactionExtraInfo = buildMotoTransactionExtraInfo({
      payeeName,
      payeeEmail,
      paymentDescription: description,
      franchiseId: franchise.id,
      franchiseName: franchise.franchise_name,
    });

    const [paymentInsert] = await connection.query(
      `INSERT INTO booking_payments
       (booking_id, payment_type, transation_id, amount, transation_type, response,
        created, isDelete, transation_extra_info, custom_payment_booking_ref, voucher_serilized_response)
       VALUES (?, 'MOTO', ?, ?, 'custom_payment', ?, ?, 1, ?, ?, '')`,
      [
        bookingId,
        orderId,
        amount,
        JSON.stringify(pendingPayload),
        created,
        transactionExtraInfo,
        orderId,
      ]
    );

    const apiBase = getApiPublicBase();
    const adminBase = getAdminFrontendBase();
    const currency = getWorldpayCurrency();
    const resultPath = `${adminBase}/admin/payments/moto/result`;
    const notifyUrl = `${apiBase}/bookings/worldpayCallbackUpdated`;
    const completeUrl = `${apiBase}/api/admin/payments/moto/complete`;
    const cancelUrl = `${apiBase}/api/admin/payments/moto/cancel`;

    if (isMockMode()) {
      await connection.commit();
      return {
        mock: true,
        integration: 'mock',
        booking_id: bookingId,
        payment_id: paymentInsert.insertId,
        order_id: orderId,
        amount,
        currency,
        franchise_name: franchise.franchise_name,
        result_url: `${resultPath}?status=success&ref=${encodeURIComponent(orderId)}&mock=1`,
        cancel_url: `${resultPath}?status=cancel&ref=${encodeURIComponent(orderId)}`,
        message:
          'WORLDPAY_MOCK_MODE is on — no call to WorldPay. Set WORLDPAY_MOCK_MODE=false to use the real MOTO payment page.',
      };
    }

    if (integration === 'access_hpp') {
      const { redirectUrl, raw } = await createAccessHostedPayment({
        orderId,
        amount,
        currency,
        description,
        payeeName,
        payeeEmail,
        resultUrls: {
          successURL: `${completeUrl}?status=success&cartId=${encodeURIComponent(orderId)}`,
          cancelURL: `${cancelUrl}?status=cancel&cartId=${encodeURIComponent(orderId)}`,
          failureURL: `${completeUrl}?status=failed&cartId=${encodeURIComponent(orderId)}`,
          errorURL: `${completeUrl}?status=failed&cartId=${encodeURIComponent(orderId)}`,
          pendingURL: `${completeUrl}?status=pending&cartId=${encodeURIComponent(orderId)}`,
          expiryURL: `${cancelUrl}?status=expiry&cartId=${encodeURIComponent(orderId)}`,
        },
      });

      await connection.query(
        `UPDATE booking_payments SET response = ? WHERE id = ?`,
        [
          JSON.stringify({
            ...pendingPayload,
            access_hpp: {
              self: raw?._links?.self?.href || null,
            },
          }),
          paymentInsert.insertId,
        ]
      );
      await connection.commit();

      return {
        mock: false,
        integration: 'access_hpp',
        booking_id: bookingId,
        payment_id: paymentInsert.insertId,
        order_id: orderId,
        amount,
        currency,
        franchise_name: franchise.franchise_name,
        redirect_url: redirectUrl,
        message: 'Redirecting to WorldPay Hosted Payment Pages (MOTO)',
      };
    }

    const fields = buildPaymentPagesFields({
      franchise,
      amount,
      payeeName,
      payeeEmail,
      notifyUrl,
      completeUrl,
      cancelUrl,
      bookingId,
    });

    await connection.commit();

    return {
      mock: false,
      integration: 'payment_pages',
      booking_id: bookingId,
      payment_id: paymentInsert.insertId,
      order_id: orderId,
      amount,
      currency,
      franchise_name: franchise.franchise_name,
      purchase_url: getWorldpayPurchaseUrl(),
      fields,
      message: 'Redirecting to WorldPay MOTO payment page',
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch (_rollbackErr) {
      // already committed / released
    }
    throw error;
  } finally {
    connection.release();
  }
}

function pickCallbackField(body, ...keys) {
  for (const key of keys) {
    if (body[key] != null && String(body[key]).trim() !== '') {
      return String(body[key]).trim();
    }
    const lower = key.toLowerCase();
    for (const [k, v] of Object.entries(body || {})) {
      if (k.toLowerCase() === lower && v != null && String(v).trim() !== '') {
        return String(v).trim();
      }
    }
  }
  return '';
}

function safeParseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

/**
 * Resolve a MOTO custom payment row by WorldPay cartId / order ref.
 * cartId may be numeric booking id (Payment Pages) or prefixed order id (Access HPP).
 * Legacy PHP deletes the placeholder booking after payment — use LEFT JOIN.
 */
async function findMotoPaymentRow(executor, ref, { forUpdate = false, bookingIdHint = null } = {}) {
  const orderRef = trim(ref);
  const clauses = [];
  const params = [];

  if (orderRef) {
    clauses.push('bp.custom_payment_booking_ref = ?');
    clauses.push('bp.transation_id = ?');
    params.push(orderRef, orderRef);
    if (/^\d+$/.test(orderRef)) {
      clauses.push('bp.booking_id = ?');
      clauses.push(`bp.custom_payment_booking_ref LIKE CONCAT('%', ?)`);
      params.push(Number(orderRef), orderRef);
    }
  }

  if (bookingIdHint) {
    clauses.push('bp.booking_id = ?');
    params.push(Number(bookingIdHint));
  }

  if (!clauses.length) {
    return null;
  }

  const lock = forUpdate ? ' FOR UPDATE' : '';
  const [rows] = await executor.query(
    `SELECT bp.*,
            b.status AS booking_status,
            b.admin_payment_received,
            b.type_of_book,
            b.booking_made_by
     FROM booking_payments bp
     LEFT JOIN bookings b ON b.id = bp.booking_id
     WHERE bp.transation_type = 'custom_payment'
       AND (${clauses.join(' OR ')})
     ORDER BY bp.id DESC
     LIMIT 1${lock}`,
    params
  );
  return rows?.[0] || null;
}

function isMotoPaymentCompleted(row) {
  if (!row || Number(row.isDelete) !== 0) {
    return false;
  }
  // Placeholder booking removed after legacy MOTO complete (booking row absent).
  if (row.booking_status == null) {
    return true;
  }
  return Number(row.booking_status) === 1;
}

async function completeMotoFromCallback(pool, body, options = {}) {
  const cartId = pickCallbackField(body, 'cartId', 'cartid', 'MC_order_id', 'transactionReference');
  const transStatus = pickCallbackField(body, 'transStatus', 'transstatus', 'outcome');
  const transId = pickCallbackField(body, 'transId', 'transid', 'paymentId');
  const callbackPw = pickCallbackField(body, 'callbackPW', 'callbackpw');
  const amountRaw = pickCallbackField(body, 'authAmount', 'amount', 'cost');
  const bookingIdHint = pickCallbackField(body, 'MC_booking_id', 'mc_booking_id');

  if (!cartId && !bookingIdHint) {
    const err = new Error('Missing cartId / order reference');
    err.status = 400;
    throw err;
  }

  const expectedPw = trim(process.env.WORLDPAY_CALLBACK_PW);
  if (expectedPw && callbackPw && callbackPw !== expectedPw) {
    const err = new Error('Invalid WorldPay callback password');
    err.status = 403;
    throw err;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const payment = await findMotoPaymentRow(connection, cartId, {
      forUpdate: true,
      bookingIdHint,
    });

    if (!payment) {
      const err = new Error('MOTO payment record not found');
      err.status = 404;
      throw err;
    }
    const bookingId = payment.booking_id;
    const statusUpper = transStatus.toUpperCase();
    const authorised =
      options.forceSuccess === true ||
      statusUpper === 'Y' ||
      statusUpper === 'AUTHORIZED' ||
      statusUpper === 'AUTHORISED' ||
      statusUpper === 'SENT_FOR_SETTLEMENT' ||
      statusUpper === 'SUCCESS' ||
      (options.allowMissingStatus && !transStatus && options.forceSuccess !== false);

    if (!authorised) {
      await connection.query(
        `UPDATE booking_payments
         SET response = ?, isDelete = 1
         WHERE id = ?`,
        [
          JSON.stringify({
            ...(safeParseJson(payment.response) || {}),
            status: 'declined_or_cancelled',
            worldpay: body,
            updated: nowMysql(),
          }),
          payment.id,
        ]
      );
      await connection.commit();
      return {
        success: false,
        booking_id: bookingId,
        order_id: payment.custom_payment_booking_ref || cartId,
        message: 'Payment was not authorised',
      };
    }

    if (Number(payment.isDelete) === 0 && Number(payment.amount) > 0) {
      await connection.commit();
      return {
        success: true,
        already_completed: true,
        booking_id: bookingId,
        order_id: payment.custom_payment_booking_ref || cartId,
        message: 'Payment already recorded',
      };
    }

    const paidAmount = Number(amountRaw) || Number(payment.amount) || 0;
    const processedAt = nowMysql();

    await connection.query(
      `UPDATE bookings
       SET status = 1,
           admin_payment_received = ?,
           payment_due = 0,
           modified = ?
       WHERE id = ?`,
      [paidAmount, processedAt, bookingId]
    );

    await connection.query(
      `UPDATE booking_payments
       SET transation_id = ?,
           amount = ?,
           response = ?,
           isDelete = 0,
           created = IFNULL(created, ?)
       WHERE id = ?`,
      [
        transId || cartId || payment.transation_id,
        paidAmount,
        JSON.stringify({
          ...(safeParseJson(payment.response) || {}),
          status: 'authorised',
          worldpay: body,
          completed: processedAt,
        }),
        processedAt,
        payment.id,
      ]
    );

    // Legacy booking-payment-moto-complete.php removes the placeholder booking row.
    await connection.query(
      `DELETE FROM bookings
       WHERE id = ? AND booking_made_by = 'moto' AND type_of_book = 'm'`,
      [bookingId]
    );

    await connection.commit();
    return {
      success: true,
      booking_id: bookingId,
      order_id: payment.custom_payment_booking_ref || cartId,
      amount: paidAmount,
      trans_id: transId || null,
      message: 'MOTO payment completed',
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function getMotoPaymentStatus(pool, orderRef) {
  const ref = trim(orderRef);
  if (!ref) {
    const err = new Error('Order reference required');
    err.status = 400;
    throw err;
  }

  const row = await findMotoPaymentRow(pool, ref);
  if (!row) {
    const err = new Error('Payment not found');
    err.status = 404;
    throw err;
  }

  const completed = isMotoPaymentCompleted(row);

  return {
    booking_id: row.booking_id,
    order_id: row.custom_payment_booking_ref || row.transation_id,
    amount: Number(row.amount) || 0,
    completed,
    booking_status:
      row.booking_status == null ? null : Number(row.booking_status),
    admin_payment_received: Number(row.admin_payment_received) || 0,
    created: row.created,
  };
}

async function mockCompleteMoto(pool, orderRef) {
  if (!isMockMode()) {
    const err = new Error('Mock complete is only available when WORLDPAY_MOCK_MODE=true');
    err.status = 403;
    throw err;
  }
  return completeMotoFromCallback(
    pool,
    {
      cartId: orderRef,
      transStatus: 'Y',
      transId: `MOCK-${Date.now()}`,
    },
    { forceSuccess: true }
  );
}

module.exports = {
  listMotoFranchises,
  initiateMotoPayment,
  completeMotoFromCallback,
  getMotoPaymentStatus,
  mockCompleteMoto,
  isMockMode,
  resolveIntegrationMode,
  hasAccessCredentials,
  createAccessHostedPayment,
  getAdminFrontendBase,
  getApiPublicBase,
  getWorldpayCurrency,
  getWorldpayPurchaseUrl,
  getWorldpayTestMode,
  formatWorldpayAmount,
  buildWorldpaySignature,
  pickCallbackField,
  buildMotoTransactionExtraInfo,
  isWorldpayTestEnvironment,
  getEnvWorldpayCredentials,
  resolveMotoWorldpayCredentials,
  getWorldpayMd5Secret,
};
