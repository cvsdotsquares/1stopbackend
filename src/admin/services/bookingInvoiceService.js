/**
 * F-018-invoice — booking invoice (legacy admin/invoice.php).
 */
const { phpSerialize, phpUnserialize } = require('../../utils/phpSerialize');
const { formatMySQLDateToDDMMYYYY, getCurrentMysqlDateTime } = require('../../utils/dateFormat');
const { sendBookingInvoiceEmail } = require('../../utils/emailService');

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function asFormNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  return String(num);
}

function currencyFormated(amount) {
  const num = Number(amount);
  const safe = Number.isFinite(num) ? num : 0;
  return `£${safe.toFixed(2)}`;
}

function todayUk() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${get('day')}/${get('month')}/${get('year')}`;
}

function formatEventDate(value) {
  return formatMySQLDateToDDMMYYYY(value) || '';
}

function getInvoiceLogoUrl() {
  const base = (
    process.env.PHP_SITE_URL ||
    process.env.FRONT_SITE_URL ||
    process.env.SITE_URL ||
    'https://www.1stopinstruction.com'
  ).replace(/\/+$/, '');
  return `${base}/img/logo.png`;
}

function joinLines(parts) {
  return parts.filter((part) => trim(part) !== '').join('\r\n');
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nl2br(value) {
  return escapeHtml(value).replace(/\r\n|\n|\r/g, '<br>');
}

const FORM_KEYS = [
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

function emptyForm() {
  return FORM_KEYS.reduce((acc, key) => {
    acc[key] = '';
    return acc;
  }, {});
}

function pickForm(source) {
  const form = emptyForm();
  if (!source || typeof source !== 'object') return form;
  for (const key of FORM_KEYS) {
    if (source[key] != null) form[key] = String(source[key]);
  }
  return form;
}

async function loadInvoiceBooking(pool, bookingId) {
  const [rows] = await pool.query(
    `SELECT
       bookings.id AS bid,
       bookings.total_fees,
       courses.dsa_fees,
       bookings.total_amount,
       bookings.payment_due,
       bookings.vat AS bvat,
       bookings.course_event_id,
       bookings.status,
       booking_attendees.first_name AS ufn,
       booking_attendees.sur_name AS usn,
       booking_attendees.email AS ueml,
       booking_attendees.booking_ref,
       course_events.event_type,
       courses.course_name,
       franchise.vat AS fvat,
       franchise.franchise_name,
       franchise.franchise_address1,
       franchise.franchise_address2,
       franchise.franchise_address3,
       franchise.franchise_address4,
       franchise.franchise_postcode,
       franchise.register_number,
       franchise.bank,
       franchise.bank_account,
       franchise.sort_code,
       franchise.payment_term,
       franchise.telephone,
       franchise.freephone,
       franchise.franchise_email,
       franchise.website,
       users.add1,
       users.add2,
       users.add3,
       users.postcode,
       (
         SELECT event_date
         FROM course_event_dates
         WHERE course_event_dates.course_event_id = bookings.course_event_id
           AND event_date != '0000-00-00'
         ORDER BY event_date DESC
         LIMIT 1
       ) AS lDate,
       (
         SELECT event_date
         FROM course_event_dates
         WHERE course_event_dates.course_event_id = bookings.course_event_id
           AND event_date != '0000-00-00'
         ORDER BY event_date ASC
         LIMIT 1
       ) AS sDate
     FROM bookings
     LEFT JOIN course_events ON bookings.course_event_id = course_events.id
     LEFT JOIN franchise ON course_events.franchise_id = franchise.id
     LEFT JOIN booking_attendees ON booking_attendees.booking_id = bookings.id
     LEFT JOIN courses ON courses.id = bookings.course_id
     LEFT JOIN users ON users.id = bookings.user_id
     WHERE bookings.status != 5 AND bookings.id = ?
     ORDER BY booking_attendees.\`primary\` DESC, booking_attendees.id ASC
     LIMIT 1`,
    [bookingId]
  );
  return rows?.[0] || null;
}

async function loadSavedInvoice(pool, bookingId) {
  const [rows] = await pool.query(
    `SELECT id, invoice FROM invoice_data WHERE booking_id = ? ORDER BY id DESC LIMIT 1`,
    [bookingId]
  );
  const row = rows?.[0];
  if (!row) return { invoice_id: 0, saved: null };
  const saved = phpUnserialize(row.invoice);
  return {
    invoice_id: Number(row.id) || 0,
    saved: saved && typeof saved === 'object' ? saved : null,
  };
}

function buildDefaultForm(bookData) {
  const price = Number(bookData.total_fees) || 0;
  const dsaFees = Number(bookData.dsa_fees) || 0;
  const amtpay = Number(bookData.total_amount) || 0;
  const amtOut = Number(bookData.payment_due) || 0;
  const amtrece = amtpay - amtOut;
  const vat = Number(bookData.bvat) || 0;
  const total = amtpay;
  const cTotal = price < dsaFees ? price - vat : price - dsaFees - vat;
  const dsa = price < dsaFees ? 0 : dsaFees;
  const pupil = `${trim(bookData.ufn)} ${trim(bookData.usn)}`.trim();
  const startDate = formatEventDate(bookData.sDate);
  const lastDate = formatEventDate(bookData.lDate);
  const invoicePeriod =
    trim(bookData.event_type) === 'multi' && startDate && lastDate
      ? `${startDate} - ${lastDate}`
      : startDate;

  const companyNo = trim(bookData.register_number)
    ? `\r\n\r\nCompany No: ${trim(bookData.register_number)}`
    : '';

  return pickForm({
    invoice_id: '',
    bid: String(bookData.bid),
    invoice_company: joinLines([
      bookData.franchise_name,
      bookData.franchise_address1,
      bookData.franchise_address2,
      bookData.franchise_address3,
      bookData.franchise_address4,
      bookData.franchise_postcode,
    ]) + companyNo,
    clien_details: joinLines([
      pupil,
      bookData.add1,
      bookData.add2,
      bookData.add3,
      bookData.postcode,
    ]),
    invoice_details: joinLines([todayUk(), bookData.booking_ref, invoicePeriod]),
    course_name: bookData.course_name || '',
    sDate: startDate,
    pupil,
    price: asFormNumber(price),
    total: asFormNumber(total),
    free_text: '',
    c_tot: asFormNumber(cTotal),
    dsa: asFormNumber(dsa),
    vat: asFormNumber(vat),
    amtpay: asFormNumber(amtpay),
    amtrece: asFormNumber(amtrece),
    amtOut: asFormNumber(amtOut),
    bank: bookData.bank || '',
    bank_account: bookData.bank_account || '',
    sort_code: bookData.sort_code || '',
    bref: bookData.booking_ref || '',
    payment_term: trim(bookData.payment_term),
    telephone: bookData.telephone || '',
    freephone: bookData.freephone || '',
    franchise_email: bookData.franchise_email || '',
    website: bookData.website || '',
  });
}

function applySavedForm(defaults, saved, invoiceId) {
  const form = { ...defaults };
  const picked = pickForm(saved);
  for (const key of FORM_KEYS) {
    if (saved && Object.prototype.hasOwnProperty.call(saved, key)) {
      form[key] = picked[key];
    }
  }
  form.invoice_id = String(invoiceId || '');
  form.bid = defaults.bid;
  form.amtOut = asFormNumber(
    (Number(form.amtpay) || 0) - (Number(form.amtrece) || 0)
  );
  return form;
}

async function getInvoice(pool, idParam) {
  const bookingId = Number(idParam);
  if (!Number.isFinite(bookingId) || bookingId <= 0) {
    const err = new Error('Invalid Booking');
    err.status = 400;
    throw err;
  }

  const bookData = await loadInvoiceBooking(pool, bookingId);
  if (!bookData) {
    const err = new Error('Invalid Booking, Try again');
    err.status = 404;
    throw err;
  }

  const { invoice_id, saved } = await loadSavedInvoice(pool, bookingId);
  const defaults = buildDefaultForm(bookData);
  const form = saved
    ? applySavedForm(defaults, saved, invoice_id)
    : { ...defaults, invoice_id: invoice_id ? String(invoice_id) : '' };

  return {
    booking_id: bookingId,
    event_id: Number(bookData.course_event_id) || 0,
    attendee_email: trim(bookData.ueml),
    invoice_id: invoice_id || 0,
    has_saved: Boolean(saved),
    show_vat: Number(bookData.fvat) === 1,
    logo_url: getInvoiceLogoUrl(),
    payment_received: Number(form.amtpay) === Number(form.amtrece),
    form,
  };
}

function buildInvoiceEmailHtml(payload) {
  const { form, show_vat, logo_url } = payload;
  const paymentReceived = Number(form.amtpay) === Number(form.amtrece);
  const freeText = trim(form.free_text);
  const vatValue = Number(form.vat) || 0;

  return `<!Doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Booking Invoice</title>
<style type="text/css">
body	 {width: 100%; background-color: #ffffff; margin:0; padding:0; -webkit-font-smoothing: antialiased;font-family: Georgia, Times, serif}
img.cmp_logo{width:95px;}
table {border-collapse: collapse;}
@media only screen and (max-width: 799px)  {
body[yahoo] .deviceWidth {width:100% !important; padding:0;}
body[yahoo] .deviceWidthmain { width:540px !important}
body[yahoo] .center {text-align: center!important;}
}
@media only screen and (max-width: 579px) {
body[yahoo] .deviceWidth {width:100% !important; padding:0;}
body[yahoo] .deviceWidthmain { width:300px !important}
body[yahoo] .center {text-align: center!important;}
}
</style>
</head>
<body  yahoo="fix" >
<table width="800" border="0" align="center" cellpadding="10" cellspacing="0" style="border:4px solid #bcbcbc;" class="deviceWidthmain">
  <tbody>
    <tr>
      <td>
	  <table width="60%" border="0" align="left" cellpadding="0" cellspacing="0" class="deviceWidth center">
        <tbody>
          <tr>
            <td><img style="width: 96px;" src="${escapeHtml(logo_url)}"  alt="logo" class="cmp_logo"></td>
          </tr>
        </tbody>
      </table>
        <table width="30%" border="0" align="right" cellpadding="0" cellspacing="0" class="deviceWidth" style="font-family:Arial, sans-serif; font-size:14px;">
			<tbody>
				<tr>
					<td height="100">${nl2br(form.invoice_company)}</td>
				</tr>
			</tbody>
        </table>
      <tr>
      <td><table width="48%" border="0" align="left" cellpadding="10" cellspacing="0" style="font-family:Arial, sans-serif; font-size:14px; border:4px solid #bcbcbc; margin-bottom:10px;" class="deviceWidth">
        <tbody>
          <tr>
            <td height="20" bgcolor="#bcbcbc" style="font-size:18px; font-family:Arial, sans-serif; color:#fff;">CLIENT</td>
          </tr>
          <tr>
            <td height="100" valign="top">${nl2br(form.clien_details)}</td>
          </tr>
        </tbody>
      </table>
        <table width="48%" border="0" align="right" cellpadding="10" cellspacing="0" style="font-family:Arial, sans-serif; font-size:14px; border:4px solid #bcbcbc;" class="deviceWidth">
          <tbody>
            <tr>
              <td height="20" bgcolor="#bcbcbc" style="font-size:18px; font-family:Arial, sans-serif; color:#fff;">INVOICE DETAILS</td>
            </tr>
            <tr>
              <td height="100" valign="top"><table width="300" border="0" cellpadding="0" cellspacing="0" style="font-family:Arial, sans-serif; font-size:14px;" class="deviceWidth">
                <tbody>
                  <tr>
                    <td height="25">
						<strong>Date: </strong><br>
						<strong>Invoice Ref: </strong><br>
						<strong>Invoice Period: </strong>
					</td>
                    <td>${nl2br(form.invoice_details)}</td>
                  </tr>
                </tbody>
              </table></td>
            </tr>
          </tbody>
        </table>${
          paymentReceived
            ? '<tr><td align="center" style="font-family:Arial, sans-serif; font-size:24px; color:#ff0000;">Payment Received</td></tr>'
            : ''
        }
    <tr>
        <td>
        <table width="100%" border="0" cellspacing="0" cellpadding="0">
          <tbody>
            <tr>
              <td style="border:1px solid #acacac;">
        <table width="35%" border="0" align="left" cellpadding="5" cellspacing="0" style="font-family:Arial, sans-serif; font-size:14px;" class="deviceWidth" >
          <tbody>
            <tr>
              <td height="20" bgcolor="#bcbcbc" style="font-size:14px; font-weight:bold; font-family:Arial, sans-serif; color:#fff; border-right:1px solid #acacac;">COURSE</td>
            </tr>
            <tr>
              <td height="50" style="border-right:1px solid #acacac;">${escapeHtml(form.course_name)}</td>
            </tr>
          </tbody>
        </table>
          <table width="15%" border="0" align="left" cellpadding="5" cellspacing="0" style="font-family:Arial, sans-serif; font-size:14px; " class="deviceWidth" >
            <tbody>
              <tr>
                <td height="20" bgcolor="#bcbcbc" style="font-size:14px; font-weight:bold; font-family:Arial, sans-serif; color:#fff; border-right:1px solid #acacac;">COURSE DATE</td>
              </tr>
              <tr>
                <td height="50" style="border-right:1px solid #acacac;">${escapeHtml(form.sDate)}</td>
              </tr>
            </tbody>
          </table>
          <table width="20%" border="0" align="left" cellpadding="5" cellspacing="0" style="font-family:Arial, sans-serif; font-size:14px;" class="deviceWidth" >
            <tbody>
              <tr>
                <td height="20" bgcolor="#bcbcbc" style="font-size:14px; font-family:Arial, sans-serif; color:#fff; font-weight:bold; border-right:1px solid #acacac;">PUPIL</td>
              </tr>
              <tr>
                <td height="50" style="border-right:1px solid #acacac;">${escapeHtml(form.pupil)}</td>
              </tr>
            </tbody>
          </table>
          <table width="15%" border="0" align="left" cellpadding="5" cellspacing="0" style="font-family:Arial, sans-serif; font-size:14px; "  class="deviceWidth ">
            <tbody>
              <tr>
                <td height="20" align="center" bgcolor="#bcbcbc" style="font-size:14px; font-family:Arial, sans-serif; color:#fff; font-weight:bold; border-right:1px solid #acacac;">PRICE</td>
              </tr>
              <tr>
                <td height="50" align="right" style="border-right:1px solid #acacac;">${currencyFormated(form.price)}</td>
              </tr>
            </tbody>
          </table>
          <table width="15%" border="0" align="left" cellpadding="5" cellspacing="0" style="font-family:Arial, sans-serif; font-size:14px;" class="deviceWidth" >
            <tbody>
              <tr>
                <td height="20" align="center" bgcolor="#bcbcbc" style="font-size:14px; font-family:Arial, sans-serif; color:#fff; font-weight:bold;">TOTAL</td>
              </tr>
              <tr>
                <td height="50" align="right">${currencyFormated(form.total)}</td>
              </tr>
            </tbody>
          </table>
          </td>
            </tr>
          </tbody>
        </table>
      <tr>
        <td>
		${
      freeText
        ? `<table width="65%" height="130" border="0" align="left" valign="" cellpadding="5" cellspacing="0" style="font-family:Arial, sans-serif; font-size:14px; border:1px solid #000;" class="deviceWidth">
				<tbody>
					<tr>
						<td align="center">${nl2br(form.free_text)}</td>
					</tr>
				</tbody>
			</table>`
        : ''
    }
		<table width="30%" border="0" align="right" cellpadding="5" cellspacing="0" style="font-family:Arial, sans-serif; font-size:14px;" class="deviceWidth">
          <tbody>
            <tr>
              <td><strong>Course Total</strong></td>
              <td align="right">${currencyFormated(form.c_tot)}</td>
            </tr>
            <tr>
              <td><strong>Disbursements</strong></td>
              <td align="right">${currencyFormated(form.dsa)}</td>
            </tr>${
              show_vat && vatValue > 0
                ? `<tr>
				  <td><strong>VAT</strong></td>
				  <td align="right">${currencyFormated(form.vat)}</td>
				</tr>`
                : ''
            }
            <tr>
              <td><strong>Amount Payable</strong></td>
              <td align="right">${currencyFormated(form.amtpay)}</td>
            </tr>
            <tr>
              <td><strong>Amount Received</strong></td>
              <td align="right">${currencyFormated(form.amtrece)}</td>
            </tr>
            <tr>
              <td><strong>Amount Outstanding</strong></td>
              <td align="right">${currencyFormated(form.amtOut)}</td>
            </tr>
          </tbody>
        </table>
      <tr>
        <td><table width="100%" border="0" cellpadding="5" cellspacing="0" style="font-family:Arial, sans-serif; font-size:14px;">
          <tbody>
            <tr>
              <td><strong>Payments Details:</strong></td>
            </tr>
          </tbody>
        </table>
          <table width="50%" border="0" align="left" cellpadding="5" cellspacing="0" style="font-family:Arial, sans-serif; font-size:12px;" class="deviceWidth">
          <tbody>
            <tr>
              <td width="120"><strong>Bank Name</strong></td>
              <td>${escapeHtml(form.bank)}</td>
            </tr>
            <tr>
              <td><strong>Account Number:</strong></td>
              <td>${escapeHtml(form.bank_account)}</td>
            </tr>
            <tr>
              <td><strong>Sort Code:</strong></td>
              <td>${escapeHtml(form.sort_code)}</td>
            </tr>
            <tr>
              <td><strong>Payment Reference:</strong></td>
              <td>${nl2br(form.bref)}</td>
            </tr>
            <tr>
              <td><strong>Payment Terms:</strong></td>
              <td>${escapeHtml(form.payment_term)} days</td>
            </tr>
          </tbody>
        </table>
          <table width="50%" border="0" cellspacing="0" cellpadding="5" style="font-family:Arial, sans-serif; font-size:12px;" class="deviceWidth">
            <tbody>
              <tr>
                <td width="120"><strong>Telephone:</strong></td>
                <td>${escapeHtml(form.telephone)}</td>
              </tr>
              <tr>
                <td><strong>Freephone:</strong></td>
                <td>${escapeHtml(form.freephone)}</td>
              </tr>
              <tr>
                <td><strong>Email:</strong></td>
                <td>${escapeHtml(form.franchise_email)}</td>
              </tr>
              <tr>
                <td><strong>Website:</strong></td>
                <td>${escapeHtml(form.website)}</td>
              </tr>
            </tbody>
          </table>
        </table>
</body>
</html>`;
}

async function saveInvoice(pool, idParam, body) {
  const payload = await getInvoice(pool, idParam);
  const bookingId = payload.booking_id;
  const form = pickForm({ ...payload.form, ...(body || {}) });
  form.bid = String(bookingId);
  if (!payload.show_vat) form.vat = '0';
  form.amtOut = asFormNumber(
    (Number(form.amtpay) || 0) - (Number(form.amtrece) || 0)
  );

  const invoiceId = Number(form.invoice_id || body?.invoice_id || 0);
  if (Number.isFinite(invoiceId) && invoiceId > 0) {
    await pool.query('DELETE FROM invoice_data WHERE id = ?', [invoiceId]);
  }

  const serialized = phpSerialize(form);
  const [result] = await pool.query(
    'INSERT INTO invoice_data (booking_id, invoice, created) VALUES (?, ?, ?)',
    [bookingId, serialized, getCurrentMysqlDateTime()]
  );

  if (!result?.insertId) {
    const err = new Error('Error in saving invoice');
    err.status = 500;
    throw err;
  }

  return {
    booking_id: bookingId,
    invoice_id: result.insertId,
    message: 'Invoice saved successfully',
  };
}

async function emailInvoice(pool, idParam, email) {
  const to = trim(email);
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    const err = new Error('Error on sending email');
    err.status = 400;
    throw err;
  }

  const payload = await getInvoice(pool, idParam);
  const bref = trim(payload.form.bref) || payload.form.bid;
  const pupil = trim(payload.form.pupil);
  const html = buildInvoiceEmailHtml(payload);
  const sent = await sendBookingInvoiceEmail(pool, {
    to,
    pupil,
    subject: `Invoice - ${bref}`,
    html,
    bookingRef: bref,
  });

  if (!sent) {
    const err = new Error('Error on sending email');
    err.status = 500;
    throw err;
  }

  return { sent: true, message: 'Invoice sent successfully' };
}

module.exports = {
  getInvoice,
  saveInvoice,
  emailInvoice,
};
