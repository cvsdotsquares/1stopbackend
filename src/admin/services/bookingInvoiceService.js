const nodemailer = require('nodemailer');
const { phpSerialize, phpUnserialize } = require('../../utils/phpSerialize');
const { getMailFrom, getMailFromAddress } = require('../../utils/mailFrom');
const { getSiteUrl } = require('../utils/siteUrl');

const smtpSecure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true';
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: smtpSecure,
  requireTLS:
    !smtpSecure &&
    String(process.env.SMTP_REQUIRE_TLS ?? 'true').toLowerCase() !== 'false',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function trimObject(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    out[key] = typeof value === 'string' ? trim(value) : value;
  }
  return out;
}

function formatDateDDMMYYYY(dateValue) {
  if (!dateValue || dateValue === '0000-00-00') return '';
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function currencyFormatted(amt) {
  const value = Number(amt);
  const safe = Number.isFinite(value) ? value : 0;
  return `£${safe.toFixed(2)}`;
}

function currencyFormattedHtml(amt) {
  const value = Number(amt);
  const safe = Number.isFinite(value) ? value : 0;
  return `&pound;${safe.toFixed(2)}`;
}

function nl2br(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r\n/g, '<br>')
    .replace(/\n/g, '<br>')
    .replace(/\r/g, '<br>');
}

function isValidEmail(email) {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}

function nowMysql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

async function loadBookData(pool, bookingId) {
  const [rows] = await pool.query(
    `SELECT bookings.*, courses.course_name, courses.dsa_fees,
      franchise.vat AS fvat, franchise.franchise_name, franchise.franchise_address1,
      franchise.franchise_address2, franchise.franchise_address3, franchise.franchise_address4,
      franchise.franchise_postcode, franchise.register_number, franchise.bank,
      franchise.bank_account, franchise.sort_code, franchise.telephone, franchise.freephone,
      franchise.franchise_email, franchise.website, franchise.payment_term,
      bookings.vat AS bvat, bookings.id AS bid, booking_attendees.first_name AS ufn,
      booking_attendees.email AS ueml, booking_attendees.sur_name AS usn,
      booking_attendees.booking_ref, users.add1, users.add2, users.add3, users.postcode,
      course_events.event_type,
      (SELECT event_date FROM course_event_dates
        WHERE course_event_dates.course_event_id = bookings.course_event_id
          AND event_date != '0000-00-00'
        ORDER BY event_date DESC LIMIT 1) AS lDate,
      (SELECT event_date FROM course_event_dates
        WHERE course_event_dates.course_event_id = bookings.course_event_id
          AND event_date != '0000-00-00'
        ORDER BY event_date ASC LIMIT 1) AS sDate
     FROM bookings
     LEFT JOIN course_events ON bookings.course_event_id = course_events.id
     LEFT JOIN franchise ON course_events.franchise_id = franchise.id
     LEFT JOIN booking_attendees ON booking_attendees.booking_id = bookings.id
     LEFT JOIN courses ON courses.id = bookings.course_id
     LEFT JOIN users ON users.id = bookings.user_id
     WHERE bookings.status != 5 AND bookings.id = ?
     LIMIT 1`,
    [Number(bookingId)]
  );
  return rows[0] || null;
}

async function loadSavedInvoice(pool, bookingId) {
  const [rows] = await pool.query(
    `SELECT id, invoice FROM invoice_data
     WHERE booking_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [Number(bookingId)]
  );
  if (!rows[0]) {
    return { invoice_id: 0, saved: {} };
  }
  let saved = {};
  try {
    saved = phpUnserialize(rows[0].invoice) || {};
  } catch {
    saved = {};
  }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
    saved = {};
  }
  return { invoice_id: Number(rows[0].id) || 0, saved };
}

function defaultInvoiceCompany(bookData) {
  const lines = [];
  if (trim(bookData.franchise_name)) lines.push(bookData.franchise_name);
  if (trim(bookData.franchise_address1)) lines.push(bookData.franchise_address1);
  if (trim(bookData.franchise_address2)) lines.push(bookData.franchise_address2);
  if (trim(bookData.franchise_address3)) lines.push(bookData.franchise_address3);
  if (trim(bookData.franchise_address4)) lines.push(bookData.franchise_address4);
  if (trim(bookData.franchise_postcode)) lines.push(bookData.franchise_postcode);
  if (trim(bookData.register_number)) {
    lines.push('');
    lines.push(`Company No: ${bookData.register_number}`);
  }
  return lines.join('\r\n');
}

function defaultClientDetails(bookData) {
  const lines = [];
  lines.push(`${trim(bookData.ufn)} ${trim(bookData.usn)}`.trim());
  if (trim(bookData.add1)) lines.push(bookData.add1);
  if (trim(bookData.add2)) lines.push(bookData.add2);
  if (trim(bookData.add3)) lines.push(bookData.add2);
  if (trim(bookData.postcode)) lines.push(bookData.postcode);
  return lines.join('\r\n');
}

function defaultInvoiceDetails(bookData) {
  const lines = [formatDateDDMMYYYY(new Date())];
  lines.push(bookData.booking_ref || '');
  if (bookData.event_type === 'multi') {
    lines.push(
      `${formatDateDDMMYYYY(bookData.sDate)} - ${formatDateDDMMYYYY(bookData.lDate)}`
    );
  } else {
    lines.push(formatDateDDMMYYYY(bookData.sDate));
  }
  return lines.join('\r\n');
}

function computeFromBooking(bookData) {
  let price = Number(bookData.total_fees) || 0;
  let dsa = Number(bookData.dsa_fees) || 0;
  const amtpay = Number(bookData.total_amount) || 0;
  const amtrece = amtpay - (Number(bookData.payment_due) || 0);
  const amtOut = Number(bookData.payment_due) || 0;
  const vat = Number(bookData.bvat) || 0;
  const total = Number(bookData.total_amount) || 0;
  const cTot =
    price < Number(bookData.dsa_fees)
      ? price - Number(bookData.bvat)
      : price - Number(bookData.dsa_fees) - Number(bookData.bvat);
  const pupil = `${trim(bookData.ufn)} ${trim(bookData.usn)}`.trim();
  const paymentTerm = bookData.payment_term != null ? String(bookData.payment_term) : '';
  if (price < dsa) {
    dsa = 0;
  }
  return {
    price,
    dsa,
    amtpay,
    amtrece,
    amtOut,
    vat,
    total,
    c_tot: cTot,
    pupil,
    payment_term: paymentTerm,
  };
}

function computeFromSaved(saved) {
  const amtpay = Number(saved.amtpay) || 0;
  const amtrece = Number(saved.amtrece) || 0;
  return {
    price: Number(saved.price) || 0,
    dsa: Number(saved.dsa) || 0,
    amtpay,
    amtrece,
    amtOut: amtpay - amtrece,
    vat: Number(saved.vat) || 0,
    total: Number(saved.total) || 0,
    c_tot: Number(saved.c_tot) || 0,
    pupil: saved.pupil || '',
    payment_term: saved.payment_term != null ? String(saved.payment_term) : '',
  };
}

function buildFormFields(bookData, saved, computed) {
  const hasSaved = saved && Object.keys(saved).length > 0;
  return {
    invoice_company: hasSaved && saved.invoice_company != null
      ? saved.invoice_company
      : defaultInvoiceCompany(bookData),
    clien_details:
      hasSaved && saved.clien_details != null ? saved.clien_details : defaultClientDetails(bookData),
    invoice_details:
      hasSaved && saved.invoice_details != null
        ? saved.invoice_details
        : defaultInvoiceDetails(bookData),
    course_name:
      hasSaved && saved.course_name != null ? saved.course_name : bookData.course_name || '',
    sDate:
      hasSaved && saved.sDate != null
        ? saved.sDate
        : formatDateDDMMYYYY(bookData.sDate),
    pupil: computed.pupil,
    price: String(computed.price),
    total: String(computed.total),
    free_text: hasSaved && saved.free_text != null ? saved.free_text : '',
    c_tot: String(computed.c_tot),
    dsa: String(computed.dsa),
    vat: String(computed.vat),
    amtpay: String(computed.amtpay),
    amtrece: String(computed.amtrece),
    amtOut: String(computed.amtOut),
    bank: hasSaved && saved.bank != null ? saved.bank : bookData.bank || '',
    bank_account:
      hasSaved && saved.bank_account != null ? saved.bank_account : bookData.bank_account || '',
    sort_code: hasSaved && saved.sort_code != null ? saved.sort_code : bookData.sort_code || '',
    bref:
      hasSaved && saved.bref != null ? saved.bref : bookData.booking_ref || '',
    payment_term: computed.payment_term,
    telephone:
      hasSaved && saved.telephone != null ? saved.telephone : bookData.telephone || '',
    freephone:
      hasSaved && saved.freephone != null ? saved.freephone : bookData.freephone || '',
    franchise_email:
      hasSaved && saved.franchise_email != null
        ? saved.franchise_email
        : bookData.franchise_email || '',
    website: hasSaved && saved.website != null ? saved.website : bookData.website || '',
  };
}

function resolveLogoUrl(req) {
  const siteUrl =
    getSiteUrl(req) ||
    String(process.env.PHP_SITE_URL || process.env.SITE_URL || 'https://1stopinstruction.com').replace(
      /\/$/,
      ''
    );
  return `${siteUrl}/img/logo.png`;
}

async function getInvoice(pool, bookingId, editable = false, req) {
  const bookData = await loadBookData(pool, bookingId);
  if (!bookData) {
    return { ok: false, message: 'Invalid Booking, Try again' };
  }

  const { invoice_id, saved } = await loadSavedInvoice(pool, bookingId);
  const computed =
    Object.keys(saved).length > 0 ? computeFromSaved(saved) : computeFromBooking(bookData);
  const form = buildFormFields(bookData, saved, computed);

  return {
    ok: true,
    data: {
      bookData: {
        bid: Number(bookData.bid),
        course_event_id: Number(bookData.course_event_id),
        booking_ref: bookData.booking_ref,
        course_name: bookData.course_name,
        event_type: bookData.event_type,
        sDate: bookData.sDate,
        lDate: bookData.lDate,
        fvat: Number(bookData.fvat),
        ueml: bookData.ueml || '',
      },
      saved,
      invoice_id,
      editable: Boolean(editable),
      computed: {
        ...computed,
        show_vat: Number(bookData.fvat) === 1,
        payment_received: computed.amtpay === computed.amtrece,
      },
      form,
      logo_url: resolveLogoUrl(req),
    },
  };
}

const INVOICE_FIELD_KEYS = [
  'invoice_id',
  'bid',
  'invoice_company',
  'clien_details',
  'invoice_details',
  'course_name',
  'sDate',
  'pupil',
  'price',
  'total',
  'free_text',
  'c_tot',
  'dsa',
  'vat',
  'amtpay',
  'amtrece',
  'amtOut',
  'bank',
  'bank_account',
  'sort_code',
  'bref',
  'payment_term',
  'telephone',
  'freephone',
  'franchise_email',
  'website',
];

async function saveInvoice(pool, bookingId, body) {
  const bookData = await loadBookData(pool, bookingId);
  if (!bookData) {
    return { ok: false, message: 'Invalid Booking, Try again' };
  }

  const payload = trimObject(body || {});
  const invoiceId = Number(payload.invoice_id) || 0;

  if (invoiceId > 0) {
    await pool.query('DELETE FROM invoice_data WHERE id = ?', [invoiceId]);
  }

  const toSave = {};
  for (const key of INVOICE_FIELD_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      toSave[key] = payload[key];
    }
  }
  toSave.bid = String(bookingId);

  const serialized = phpSerialize(toSave);
  const [result] = await pool.query(
    'INSERT INTO invoice_data (booking_id, invoice, created) VALUES (?, ?, ?)',
    [Number(bookingId), serialized, nowMysql()]
  );

  if (!result || !result.insertId) {
    return { ok: false, message: 'Error in saving invoice' };
  }

  return { ok: true, message: 'Invoice saved successfully' };
}

function buildInvoiceEmailHtml(bookData, saved, pupil, siteUrl) {
  const computed =
    saved && Object.keys(saved).length > 0
      ? computeFromSaved(saved)
      : computeFromBooking(bookData);
  const {
    price,
    dsa,
    amtpay,
    amtrece,
    amtOut,
    vat,
    total,
    c_tot: cTotal,
    payment_term: paymentTerm,
  } = computed;

  const logoUrl = `${String(siteUrl).replace(/\/$/, '')}/img/logo.png`;
  const bref =
    saved && saved.bref != null ? saved.bref : bookData.booking_ref || '';

  const invoiceCompany =
    saved && saved.invoice_company != null
      ? saved.invoice_company
      : defaultInvoiceCompany(bookData);
  const clientDetails =
    saved && saved.clien_details != null ? saved.clien_details : defaultClientDetails(bookData);
  const invoiceDetails =
    saved && saved.invoice_details != null
      ? saved.invoice_details
      : defaultInvoiceDetails(bookData);
  const courseName =
    saved && saved.course_name != null ? saved.course_name : bookData.course_name || '';
  const sDate =
    saved && saved.sDate != null ? saved.sDate : formatDateDDMMYYYY(bookData.sDate);

  const paymentReceivedRow =
    amtpay === amtrece
      ? `<tr><td align="center" style="font-family:Arial, sans-serif; font-size:24px; color:#ff0000;">Payment Received</td></tr>`
      : '';

  const freeTextBlock =
    saved && trim(saved.free_text)
      ? `<table width="65%" height="130" border="0" align="left" valign="" cellpadding="5" cellspacing="0" style="font-family:Arial, sans-serif; font-size:14px; border:1px solid #000;" class="deviceWidth"><tbody><tr><td align="center">${nl2br(saved.free_text)}</td></tr></tbody></table>`
      : '';

  const vatRow =
    vat > 0
      ? `<tr><td><strong>VAT</strong></td><td align="right">${currencyFormattedHtml(vat)}</td></tr>`
      : '';

  return `<!Doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Booking Invoice</title>
<style type="text/css">
body {width: 100%; background-color: #ffffff; margin:0; padding:0; -webkit-font-smoothing: antialiased;font-family: Georgia, Times, serif}
img.cmp_logo{width:95px;}
table {border-collapse: collapse;}
</style>
</head>
<body yahoo="fix">
<table width="800" border="0" align="center" cellpadding="10" cellspacing="0" style="border:4px solid #bcbcbc;" class="deviceWidthmain">
<tbody>
<tr><td>
<table width="60%" border="0" align="left" cellpadding="0" cellspacing="0" class="deviceWidth center"><tbody><tr><td><img style="width: 96px;" src="${logoUrl}" alt="logo" class="cmp_logo"></td></tr></tbody></table>
<table width="30%" border="0" align="right" cellpadding="0" cellspacing="0" class="deviceWidth" style="font-family:Arial, sans-serif; font-size:14px;"><tbody><tr><td height="100">${nl2br(invoiceCompany)}</td></tr></tbody></table>
<tr><td>
<table width="48%" border="0" align="left" cellpadding="10" cellspacing="0" style="font-family:Arial, sans-serif; font-size:14px; border:4px solid #bcbcbc; margin-bottom:10px;" class="deviceWidth"><tbody>
<tr><td height="20" bgcolor="#bcbcbc" style="font-size:18px; font-family:Arial, sans-serif; color:#fff;">CLIENT</td></tr>
<tr><td height="100" valign="top">${nl2br(clientDetails)}</td></tr>
</tbody></table>
<table width="48%" border="0" align="right" cellpadding="10" cellspacing="0" style="font-family:Arial, sans-serif; font-size:14px; border:4px solid #bcbcbc;" class="deviceWidth"><tbody>
<tr><td height="20" bgcolor="#bcbcbc" style="font-size:18px; font-family:Arial, sans-serif; color:#fff;">INVOICE DETAILS</td></tr>
<tr><td height="100" valign="top"><table width="300" border="0" cellpadding="0" cellspacing="0" style="font-family:Arial, sans-serif; font-size:14px;" class="deviceWidth"><tbody><tr><td height="25"><strong>Date: </strong><br><strong>Invoice Ref: </strong><br><strong>Invoice Period: </strong></td><td>${nl2br(invoiceDetails)}</td></tr></tbody></table></td></tr>
</tbody></table>
${paymentReceivedRow}
<tr><td>
<table width="100%" border="0" cellspacing="0" cellpadding="0"><tbody><tr><td style="border:1px solid #acacac;">
<table width="35%" border="0" align="left" cellpadding="5" cellspacing="0" style="font-family:Arial, sans-serif; font-size:14px;" class="deviceWidth"><tbody><tr><td height="20" bgcolor="#bcbcbc" style="font-size:14px; font-weight:bold; font-family:Arial, sans-serif; color:#fff; border-right:1px solid #acacac;">COURSE</td></tr><tr><td height="50" style="border-right:1px solid #acacac;">${courseName}</td></tr></tbody></table>
<table width="15%" border="0" align="left" cellpadding="5" cellspacing="0" style="font-family:Arial, sans-serif; font-size:14px;" class="deviceWidth"><tbody><tr><td height="20" bgcolor="#bcbcbc" style="font-size:14px; font-weight:bold; font-family:Arial, sans-serif; color:#fff; border-right:1px solid #acacac;">COURSE DATE</td></tr><tr><td height="50" style="border-right:1px solid #acacac;">${sDate}</td></tr></tbody></table>
<table width="20%" border="0" align="left" cellpadding="5" cellspacing="0" style="font-family:Arial, sans-serif; font-size:14px;" class="deviceWidth"><tbody><tr><td height="20" bgcolor="#bcbcbc" style="font-size:14px; font-family:Arial, sans-serif; color:#fff; font-weight:bold; border-right:1px solid #acacac;">PUPIL</td></tr><tr><td height="50" style="border-right:1px solid #acacac;">${pupil}</td></tr></tbody></table>
<table width="15%" border="0" align="left" cellpadding="5" cellspacing="0" style="font-family:Arial, sans-serif; font-size:14px;" class="deviceWidth"><tbody><tr><td height="20" align="center" bgcolor="#bcbcbc" style="font-size:14px; font-family:Arial, sans-serif; color:#fff; font-weight:bold; border-right:1px solid #acacac;">PRICE</td></tr><tr><td height="50" align="right" style="border-right:1px solid #acacac;">${currencyFormattedHtml(price)}</td></tr></tbody></table>
<table width="15%" border="0" align="left" cellpadding="5" cellspacing="0" style="font-family:Arial, sans-serif; font-size:14px;" class="deviceWidth"><tbody><tr><td height="20" align="center" bgcolor="#bcbcbc" style="font-size:14px; font-family:Arial, sans-serif; color:#fff; font-weight:bold;">TOTAL</td></tr><tr><td height="50" align="right">${currencyFormattedHtml(total)}</td></tr></tbody></table>
</td></tr></tbody></table>
<tr><td>
${freeTextBlock}
<table width="30%" border="0" align="right" cellpadding="5" cellspacing="0" style="font-family:Arial, sans-serif; font-size:14px;" class="deviceWidth"><tbody>
<tr><td><strong>Course Total</strong></td><td align="right">${currencyFormattedHtml(cTotal)}</td></tr>
<tr><td><strong>Disbursements</strong></td><td align="right">${currencyFormattedHtml(dsa)}</td></tr>
${vatRow}
<tr><td><strong>Amount Payable</strong></td><td align="right">${currencyFormattedHtml(amtpay)}</td></tr>
<tr><td><strong>Amount Received</strong></td><td align="right">${currencyFormattedHtml(amtrece)}</td></tr>
<tr><td><strong>Amount Outstanding</strong></td><td align="right">${currencyFormattedHtml(amtOut)}</td></tr>
</tbody></table>
<tr><td>
<table width="100%" border="0" cellpadding="5" cellspacing="0" style="font-family:Arial, sans-serif; font-size:14px;"><tbody><tr><td><strong>Payments Details:</strong></td></tr></tbody></table>
<table width="50%" border="0" align="left" cellpadding="5" cellspacing="0" style="font-family:Arial, sans-serif; font-size:12px;" class="deviceWidth"><tbody>
<tr><td width="120"><strong>Bank Name</strong></td><td>${saved && saved.bank != null ? saved.bank : bookData.bank || ''}</td></tr>
<tr><td><strong>Account Number:</strong></td><td>${saved && saved.bank_account != null ? saved.bank_account : bookData.bank_account || ''}</td></tr>
<tr><td><strong>Sort Code:</strong></td><td>${saved && saved.sort_code != null ? saved.sort_code : bookData.sort_code || ''}</td></tr>
<tr><td><strong>Payment Reference:</strong></td><td>${bref}</td></tr>
<tr><td><strong>Payment Terms:</strong></td><td>${paymentTerm} days</td></tr>
</tbody></table>
<table width="50%" border="0" cellspacing="0" cellpadding="5" style="font-family:Arial, sans-serif; font-size:12px;" class="deviceWidth"><tbody>
<tr><td width="120"><strong>Telephone:</strong></td><td>${saved && saved.telephone != null ? saved.telephone : bookData.telephone || ''}</td></tr>
<tr><td><strong>Freephone:</strong></td><td>${saved && saved.freephone != null ? saved.freephone : bookData.freephone || ''}</td></tr>
<tr><td><strong>Email:</strong></td><td>${saved && saved.franchise_email != null ? saved.franchise_email : bookData.franchise_email || ''}</td></tr>
<tr><td><strong>Website:</strong></td><td>${saved && saved.website != null ? saved.website : bookData.website || ''}</td></tr>
</tbody></table>
</td></tr></tbody></table>
</body>
</html>`;
}

async function logEmail(pool, { to, subject, html, status, type, bookRef }) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO email_logs (\`to\`, cc, bcc, \`from\`, subject, email_content, status, type, book_ref, created)
       VALUES (?, '', '', ?, ?, ?, ?, ?, ?, NOW())`,
      [to, getMailFromAddress(), subject, html, status, type, bookRef || '']
    );
  } catch (err) {
    console.error('[ADMIN][INVOICE][EMAIL_LOG]', err.message);
  }
}

async function sendInvoiceEmail(pool, bookingId, email, req) {
  const bookData = await loadBookData(pool, bookingId);
  if (!bookData) {
    return { ok: false, message: 'Invalid Booking, Try again' };
  }

  const to = trim(email);
  if (!isValidEmail(to)) {
    return { ok: false, message: 'Error on sending email' };
  }

  const { saved } = await loadSavedInvoice(pool, bookingId);
  const computed =
    Object.keys(saved).length > 0 ? computeFromSaved(saved) : computeFromBooking(bookData);
  const pupil = computed.pupil;
  const bref = saved && saved.bref != null ? saved.bref : bookData.booking_ref || '';
  const siteUrl =
    getSiteUrl(req) ||
    String(process.env.PHP_SITE_URL || process.env.SITE_URL || 'https://1stopinstruction.com').replace(
      /\/$/,
      ''
    );

  const html = buildInvoiceEmailHtml(bookData, saved, pupil, siteUrl);
  const subject = `Invoice - ${bref}`;
  const logType = `Invoice - ${bref}`;

  let status = 0;
  try {
    await transporter.sendMail({
      from: getMailFrom(),
      to: { name: pupil, address: to },
      subject,
      html,
      text: html.replace(/<[^>]+>/g, ' '),
    });
    status = 1;
  } catch (err) {
    console.error('[ADMIN][INVOICE][EMAIL]', err.message);
    status = 0;
  }

  await logEmail(pool, {
    to,
    subject,
    html,
    status,
    type: logType,
    bookRef: bookData.booking_ref,
  });

  if (status !== 1) {
    return { ok: false, message: 'Error on sending email' };
  }

  return { ok: true, message: 'Invoice sent successfully' };
}

module.exports = {
  getInvoice,
  saveInvoice,
  sendInvoiceEmail,
  currencyFormatted,
};
