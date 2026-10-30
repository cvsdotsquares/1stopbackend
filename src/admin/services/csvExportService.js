const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getMailFromAddress } = require('../../utils/mailFrom');
const { sendCourseDatesCsvEmail } = require('../../utils/emailService');
const { getEmailTemplateById } = require('./emailTemplatesService');

const MAX_EDITED_BODY = 200000;

const COLUMNS = [
  'Course',
  'Location',
  'Start Date',
  'Start Time/End Time',
  'Price',
  'Current Bookings',
  'Booking Limit',
];

const MAX_ROWS = 200;
const MAX_FIELD = 200;

function nowMysql() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function clip(value) {
  return String(value ?? '').trim().slice(0, MAX_FIELD);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    const err = new Error('Select at least one course date.');
    err.status = 400;
    throw err;
  }
  if (rows.length > MAX_ROWS) {
    const err = new Error(`Select no more than ${MAX_ROWS} course dates.`);
    err.status = 400;
    throw err;
  }
  return rows.map((row) => ({
    course: clip(row.course),
    location: clip(row.location),
    startDate: clip(row.startDate),
    time: clip(row.time),
    price: clip(row.price),
    currentBookings: clip(row.currentBookings),
    bookingLimit: clip(row.bookingLimit),
  }));
}

function buildCsv(rows) {
  const lines = [COLUMNS.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.course,
        row.location,
        row.startDate,
        row.time,
        row.price,
        row.currentBookings,
        row.bookingLimit,
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  return lines.join('\r\n');
}

function buildTableHtml(rows) {
  const bodyRows = rows
    .map(
      (row) => `<tr>
        <td>${htmlEscape(row.course)}</td>
        <td>${htmlEscape(row.location)}</td>
        <td>${htmlEscape(row.startDate)}</td>
        <td>${htmlEscape(row.time)}</td>
        <td>${htmlEscape(row.price)}</td>
        <td>${htmlEscape(row.currentBookings)}</td>
        <td>${htmlEscape(row.bookingLimit)}</td>
      </tr>`
    )
    .join('');

  return `<table border="1" cellpadding="6" cellspacing="0">
  <thead>
    <tr>${COLUMNS.map((column) => `<th>${htmlEscape(column)}</th>`).join('')}</tr>
  </thead>
  <tbody>${bodyRows}</tbody>
</table>`;
}

function renderTemplateBody(body, { name, rows, paymentUrl }) {
  const source = String(body || '');
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(source);
  const prepared = looksLikeHtml
    ? source
    : htmlEscape(source).replace(/\r\n|\r|\n/g, '<br/>');
  const linkHtml = `<a href="${htmlEscape(paymentUrl)}">${htmlEscape(paymentUrl)}</a>`;
  return prepared
    .replaceAll('[client_name]', htmlEscape(name || ''))
    .replaceAll('[exported_table]', buildTableHtml(rows))
    .replaceAll('[payment_link]', linkHtml);
}

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function formatMoney(unitAmount, currency) {
  if (!Number.isFinite(unitAmount)) return '';
  const major = (unitAmount / 100).toFixed(2);
  if (String(currency || 'gbp').toLowerCase() === 'gbp') return `£${major}`;
  return `${major} ${String(currency || '').toUpperCase()}`;
}

function priceOptionLabel(price) {
  const product = price?.product;
  const productName =
    product && typeof product === 'object' && product.name
      ? String(product.name).trim()
      : 'Product';
  const amount = formatMoney(price.unit_amount, price.currency);
  const recurring = price.recurring;
  const interval = recurring?.interval
    ? (Number(recurring.interval_count) > 1
      ? ` / ${recurring.interval_count} ${recurring.interval}s`
      : ` / ${recurring.interval}`)
    : '';
  const nickname = price.nickname ? String(price.nickname).trim() : '';
  const parts = [productName];
  if (nickname) parts.push(nickname);
  const money = `${amount}${interval}`.trim();
  if (money) parts.push(money);
  if (price.active === false || (product && typeof product === 'object' && product.active === false)) {
    parts.push('(inactive)');
  }
  return parts.join(' — ');
}

async function listEveryPaymentLink() {
  const links = [];
  let startingAfter = '';
  while (links.length < 1000) {
    const page = await stripe.paymentLinks.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const batch = page.data || [];
    links.push(...batch);
    if (!page.has_more || !batch.length) break;
    startingAfter = batch[batch.length - 1].id;
  }
  return links;
}

async function lineItemsForLink(linkId) {
  const lines = [];
  let startingAfter = '';
  while (lines.length < 20) {
    const page = await stripe.paymentLinks.listLineItems(linkId, {
      limit: 20,
      expand: ['data.price.product'],
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const batch = page.data || [];
    lines.push(...batch);
    if (!page.has_more || !batch.length) break;
    startingAfter = batch[batch.length - 1].id;
  }
  return lines;
}

async function mapWithLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const current = next;
      next += 1;
      results[current] = await worker(items[current]);
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => run()));
  return results;
}

async function listEveryPrice() {
  const prices = [];
  let startingAfter = '';
  while (prices.length < 1000) {
    const page = await stripe.prices.list({
      limit: 100,
      expand: ['data.product'],
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const batch = page.data || [];
    prices.push(...batch);
    if (!page.has_more || !batch.length) break;
    startingAfter = batch[batch.length - 1].id;
  }
  return prices;
}

function linePriceId(line) {
  const price = line?.price;
  if (!price) return '';
  return typeof price === 'string' ? price : price.id || '';
}

async function paymentLinkBySinglePrice(links) {
  const map = new Map();
  await mapWithLimit(links, 8, async (link) => {
    if (!link?.url) return;
    let lines = [];
    try {
      lines = await lineItemsForLink(link.id);
    } catch (lineErr) {
      console.error('[ADMIN][CSV_EXPORT][PAYMENT_LINKS][ITEMS]', lineErr.message);
      return;
    }
    const priceIds = [...new Set(lines.map(linePriceId).filter(Boolean))];
    if (priceIds.length !== 1) return;
    const priceId = priceIds[0];
    const current = map.get(priceId);
    if (!current || (link.active && current.active === false)) {
      map.set(priceId, link);
    }
  });
  return map;
}

async function ensurePaymentLinkForPrice(priceId, existing) {
  if (existing?.id && existing.url) return existing;
  return stripe.paymentLinks.create({
    line_items: [{ price: priceId, quantity: 1 }],
  });
}

async function listStripePaymentLinks() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw httpError('Stripe is not configured.', 500);
  }
  let prices;
  let links;
  try {
    [prices, links] = await Promise.all([listEveryPrice(), listEveryPaymentLink()]);
  } catch (stripeErr) {
    throw httpError(
      stripeErr?.raw?.message || stripeErr?.message || 'Unable to load payment links.',
      502
    );
  }

  const byPrice = await paymentLinkBySinglePrice(links);
  const usable = (prices || []).filter((price) => {
    const product = price?.product;
    if (product && typeof product === 'object' && product.deleted) return false;
    return Boolean(price?.id);
  });

  let firstError = null;
  const items = await mapWithLimit(usable, 4, async (price) => {
    try {
      const link = await ensurePaymentLinkForPrice(price.id, byPrice.get(price.id));
      if (!link?.id || !link.url) return null;
      return {
        id: link.id,
        url: link.url,
        label: priceOptionLabel(price),
      };
    } catch (stripeErr) {
      firstError = stripeErr;
      console.error('[ADMIN][CSV_EXPORT][PAYMENT_LINKS][PRICE]', price.id, stripeErr.message);
      return null;
    }
  });

  const ready = items.filter(Boolean);
  if (!ready.length && firstError) {
    throw httpError(
      firstError?.raw?.message || firstError?.message || 'Unable to load payment links.',
      502
    );
  }
  ready.sort((a, b) => a.label.localeCompare(b.label));
  return ready;
}

async function resolvePaymentLink(paymentLinkId) {
  const id = String(paymentLinkId || '').trim();
  if (!id.startsWith('plink_')) {
    throw httpError('Select a payment link.', 400);
  }
  let link;
  try {
    link = await stripe.paymentLinks.retrieve(id);
  } catch {
    throw httpError('The payment link could not be found.', 400);
  }
  if (!link.url) {
    throw httpError('This payment link has no URL.', 400);
  }
  return link.url;
}

async function resolveRecipient(pool, { customerId, email, name }) {
  const typedEmail = String(email || '').trim();
  const typedName = clip(name);
  const id = Number(customerId);

  if (Number.isFinite(id) && id > 0) {
    const [rows] = await pool.query(
      `SELECT first_name, sur_name, email
       FROM booking_attendees_dropdown
       WHERE id = ?
       LIMIT 1`,
      [id]
    );
    const row = rows?.[0];
    if (!row) {
      const err = new Error('Customer not found.');
      err.status = 400;
      throw err;
    }
    const customerEmail = String(row.email || '').trim() || typedEmail;
    if (!isEmail(customerEmail)) {
      const err = new Error(
        'This customer has no email address. Enter an email to share the dates.'
      );
      err.status = 400;
      throw err;
    }
    const customerName =
      [row.first_name, row.sur_name].filter(Boolean).join(' ').trim() || typedName;
    return { email: customerEmail, name: customerName };
  }

  if (!isEmail(typedEmail)) {
    const err = new Error('Enter an email address for the new customer.');
    err.status = 400;
    throw err;
  }
  return { email: typedEmail, name: typedName };
}

async function shareCourseDatesCsv(pool, payload, emailBy) {
  const rows = normalizeRows(payload.rows);
  const recipient = await resolveRecipient(pool, payload);
  const templateId = Number(payload.templateId);
  if (!Number.isFinite(templateId) || templateId <= 0) {
    throw httpError('Select an email template.', 400);
  }
  const template = await getEmailTemplateById(pool, templateId);
  if (!template) {
    throw httpError('Email template not found.', 400);
  }
  const paymentUrl = await resolvePaymentLink(payload.paymentLinkId);
  const editedBody = String(payload.body || '').trim();
  if (editedBody.length > MAX_EDITED_BODY) {
    throw httpError('The email is too long.', 400);
  }
  const csv = buildCsv(rows);
  const subject = String(template.title || 'Course dates from 1 Stop Instruction').slice(0, 200);
  const html = renderTemplateBody(editedBody || template.body, {
    name: recipient.name,
    rows,
    paymentUrl,
  });
  const filename = 'course-dates.csv';

  let emailStatus = 0;
  let emailError = '';
  try {
    await sendCourseDatesCsvEmail({
      to: recipient.email,
      subject,
      html,
      filename,
      csv,
    });
    emailStatus = 1;
  } catch (mailErr) {
    emailError = mailErr?.message || String(mailErr);
    const err = new Error(`The email could not be sent. ${emailError}`);
    err.status = 502;
    throw err;
  } finally {
    try {
      await pool.query(
        `INSERT INTO email_logs (book_ref, \`to\`, cc, bcc, \`from\`, subject, email_content, email_by, status, created, type, error)
         VALUES (?, ?, '', '', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          '',
          recipient.email,
          getMailFromAddress(),
          subject,
          html,
          String(emailBy || 'admin').slice(0, 50),
          emailStatus,
          nowMysql(),
          'CSV Export',
          emailError,
        ]
      );
    } catch (logErr) {
      console.error('[ADMIN][CSV_EXPORT][LOG]', logErr.message);
    }
  }

  return {
    email: recipient.email,
    message: `Course dates sent to ${recipient.email}.`,
  };
}

module.exports = {
  shareCourseDatesCsv,
  listStripePaymentLinks,
  buildCsv,
  normalizeRows,
};
