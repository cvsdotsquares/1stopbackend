/**
 * Admin add-booking Stripe payment link.
 *
 * One-time Checkout Session. Expiry follows remaining space-reservation time:
 * remaining minutes are rounded down, then 30 seconds are subtracted for email
 * delivery so the link always dies before the lock banner reaches 00:00.
 */
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { findOrCreateStripeCustomerByEmail } = require('../../utils/stripeCustomer');
const { sendAdminStripePaymentLinkEmail } = require('../../utils/emailService');
const { getAdminFrontendBase } = require('./motoPaymentService');
const { sendAdminBookingConfirmationEmail } = require('./adminBookingEmailService');
const { LOCK_EXPIRE_TIME_MINUTES } = require('../constants');

const METADATA_TYPE = 'admin_payment_link';
const PENDING_PAYMENT_TYPE = 'STRIPE_LINK';
const EMAIL_DELIVERY_BUFFER_MS = 30 * 1000;

/**
 * One booking_payments row per booking: reuse the pending STRIPE_LINK row
 * (or any existing row) instead of inserting SALE beside it.
 */
async function upsertSingleBookingPayment(pool, {
  bookingId,
  paymentType,
  transactionId,
  amount,
  transationType,
  response,
  created,
}) {
  const [rows] = await pool.query(
    `SELECT id, payment_type
     FROM booking_payments
     WHERE booking_id = ?
     ORDER BY CASE WHEN payment_type = ? THEN 0 ELSE 1 END, id ASC`,
    [bookingId, PENDING_PAYMENT_TYPE]
  );
  const keepId = rows?.[0]?.id || 0;

  if (keepId) {
    await pool.query(
      `UPDATE booking_payments
       SET payment_type = ?,
           transation_id = ?,
           transation_type = ?,
           amount = ?,
           response = ?,
           isDelete = 0
       WHERE id = ?`,
      [
        paymentType,
        transactionId,
        transationType,
        amount,
        response,
        keepId,
      ]
    );
    await pool.query(
      'DELETE FROM booking_payments WHERE booking_id = ? AND id != ?',
      [bookingId, keepId]
    );
    return keepId;
  }

  const [insertResult] = await pool.query(
    `INSERT INTO booking_payments
      (booking_id, payment_type, transation_id, amount, transation_type, response,
       created, isDelete, custom_payment_booking_ref, voucher_serilized_response)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, '', '')`,
    [
      bookingId,
      paymentType,
      transactionId,
      amount,
      transationType,
      response,
      created,
    ]
  );
  return insertResult.insertId;
}

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function nowMysql() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function getExpireMinutes() {
  const parsed = Number(process.env.STRIPE_PAYMENT_LINK_EXPIRE_MINUTES || 20);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
}

function parseMysqlDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(raw)) {
    const d = new Date(raw.replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getLockExpiryDate(session, lockExpiresAt) {
  if (lockExpiresAt) {
    const fromArg = new Date(lockExpiresAt);
    if (!Number.isNaN(fromArg.getTime())) return fromArg;
  }
  const adminBooking = session?.adminBooking;
  const lockCountdown = adminBooking?.lock_countdown;
  if (lockCountdown) {
    return new Date(
      (Number(lockCountdown) + LOCK_EXPIRE_TIME_MINUTES * 60) * 1000
    );
  }
  const created = parseMysqlDateTime(adminBooking?.lock_session?.created);
  if (created) {
    return new Date(created.getTime() + LOCK_EXPIRE_TIME_MINUTES * 60 * 1000);
  }
  return null;
}

/**
 * Remaining lock time, minutes rounded down, then minus 30s for email delivery.
 * quotedMinutes is what we tell the customer; expiresAt is when we actually close.
 */
function computePaymentLinkExpiry(lockExpiresAt) {
  const lockMs = lockExpiresAt instanceof Date
    ? lockExpiresAt.getTime()
    : new Date(lockExpiresAt).getTime();
  if (!Number.isFinite(lockMs)) {
    const err = new Error('Booking reservation time could not be determined');
    err.status = 400;
    throw err;
  }
  const remainingMs = lockMs - Date.now();
  const quotedMinutes = Math.floor(remainingMs / 60000);
  if (quotedMinutes < 1) {
    const err = new Error(
      'Not enough reservation time left to send a payment link. Start the booking again.'
    );
    err.status = 400;
    throw err;
  }
  const expiresAt = new Date(Date.now() + quotedMinutes * 60000 - EMAIL_DELIVERY_BUFFER_MS);
  if (expiresAt.getTime() <= Date.now()) {
    const err = new Error(
      'Not enough reservation time left to send a payment link. Start the booking again.'
    );
    err.status = 400;
    throw err;
  }
  return { expiresAt, quotedMinutes };
}

function formatAmountLabel(amount, currency = 'gbp') {
  const value = Number(amount) || 0;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: String(currency || 'gbp').toUpperCase(),
  }).format(value);
}

function chargeAmountForAttendee(attendee, showCancellation) {
  const courseCost = Number(attendee.course_cost) || 0;
  const paymentReceived = Number(attendee.payment_received) || 0;
  const amountOutstanding = Number(attendee.amount_outstanding) || 0;
  if (amountOutstanding > 0) return courseCost - amountOutstanding;
  return showCancellation ? courseCost : paymentReceived;
}

function toMinorUnits(amount) {
  return Math.round(Number(amount) * 100);
}

function parseBookingIds(metadata) {
  const raw = trim(metadata?.booking_ids || metadata?.booking_id);
  if (!raw) return [];
  return raw
    .split(',')
    .map((id) => Number.parseInt(id, 10))
    .filter((id) => Number.isFinite(id) && id > 0);
}

function isAdminPaymentLink(metadata) {
  return trim(metadata?.type) === METADATA_TYPE;
}

async function removeLockById(pool, lockId, revertVehicleCounts = true) {
  const { removeLockById: remove } = require('./bookingWorldpayService');
  return remove(pool, lockId, revertVehicleCounts);
}

async function deleteUnpaidAdminBookings(pool, bookingIds) {
  const ids = [...new Set((bookingIds || []).map((id) => Number(id)).filter(Boolean))];
  if (!ids.length) return { deleted: 0, lockId: 0 };

  let lockId = 0;
  let deleted = 0;

  for (const bookingId of ids) {
    const [bookingRows] = await pool.query(
      'SELECT id, status, lockid, admin_payment_received FROM bookings WHERE id = ? LIMIT 1',
      [bookingId]
    );
    const booking = bookingRows?.[0];
    if (!booking) continue;
    if (Number(booking.status) === 1 || Number(booking.admin_payment_received) > 0) {
      continue;
    }
    lockId = Number(booking.lockid) || lockId;
    await pool.query('DELETE FROM booking_attendees WHERE booking_id = ?', [bookingId]);
    await pool.query('DELETE FROM booking_attendees_dropdown WHERE booking_id = ?', [
      bookingId,
    ]);
    await pool.query('DELETE FROM booking_payments WHERE booking_id = ?', [bookingId]);
    await pool.query('DELETE FROM bookings WHERE id = ?', [bookingId]);
    deleted += 1;
  }

  return { deleted, lockId };
}

async function cancelUnpaidAdminStripeBookings(pool, bookingIds, session, options = {}) {
  const releaseLock = options.releaseLock !== false;
  const { deleted, lockId } = await deleteUnpaidAdminBookings(pool, bookingIds);
  if (releaseLock) {
    const sessionLockId = Number(session?.adminBooking?.lock_session?.id) || 0;
    const resolvedLockId = lockId || sessionLockId;
    if (resolvedLockId) {
      await removeLockById(pool, resolvedLockId, true);
    }
    if (session) {
      delete session.adminBooking;
      delete session.stripePaymentLink;
      delete session.preFillData;
      delete session.courseEvent;
    }
  }
  return { cancelled: true, deleted };
}

async function createAdminStripePaymentLink(pool, session, {
  bookingIds,
  bookingRefs,
  event,
  attendees,
  showCancellation,
  lockExpiresAt,
}) {
  if (!trim(process.env.STRIPE_SECRET_KEY)) {
    const err = new Error('Stripe is not configured (STRIPE_SECRET_KEY)');
    err.status = 400;
    throw err;
  }

  const amount = (attendees || []).reduce(
    (sum, attendee) => sum + chargeAmountForAttendee(attendee, showCancellation),
    0
  );
  const minorAmount = toMinorUnits(amount);
  if (!Number.isFinite(minorAmount) || minorAmount <= 0) {
    const err = new Error('Payment amount must be greater than zero');
    err.status = 400;
    throw err;
  }

  const primary = attendees?.[0] || {};
  const primaryName = `${trim(primary.first_name)} ${trim(primary.sur_name)}`.trim();
  const cartId = (bookingRefs || []).join('-');
  const lockExpiryDate = getLockExpiryDate(session, lockExpiresAt);
  if (!lockExpiryDate) {
    const err = new Error('Booking reservation time could not be determined');
    err.status = 400;
    throw err;
  }
  const { expiresAt, quotedMinutes } = computePaymentLinkExpiry(lockExpiryDate);
  const adminBase = getAdminFrontendBase();
  const eventId = Number(event?.id) || Number(session?.adminBooking?.eventId) || 0;
  const lockId = Number(session?.adminBooking?.lock_session?.id) || 0;
  const spaces = bookingIds.length;

  const attendeeSummary = (attendees || [])
    .map((attendee, index) => {
      const name = `${trim(attendee.first_name)} ${trim(attendee.sur_name)}`.trim();
      const ref = bookingRefs[index] || '';
      return `${name}${ref ? ` (${ref})` : ''}`.trim();
    })
    .filter(Boolean)
    .join(' & ');

  const description = [attendeeSummary, '-', event?.course_name, event?.location_name]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);

  const stripeCustomerId = await findOrCreateStripeCustomerByEmail({
    email: primary.email,
    name: primaryName,
    phone: primary.contact1,
    metadata: {
      source: METADATA_TYPE,
      first_booking_ref: bookingRefs[0] || '',
    },
  });

  const metadata = {
    type: METADATA_TYPE,
    booking_ids: bookingIds.join(','),
    booking_id: String(bookingIds[0] || ''),
    booking_refs: bookingRefs.join(','),
    cart_id: cartId,
    course_event_id: String(eventId),
    spaces: String(spaces),
    lock_id: String(lockId),
    expire_at: String(Math.floor(expiresAt.getTime() / 1000)),
  };

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: 'payment',
    ...(stripeCustomerId
      ? { customer: stripeCustomerId }
      : primary.email
        ? { customer_email: trim(primary.email) }
        : {}),
    client_reference_id: cartId.slice(0, 200),
    success_url: `${adminBase}/pay/complete?status=success`,
    cancel_url: `${adminBase}/pay/complete?status=cancelled`,
    after_expiration: { recovery: { enabled: false } },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'gbp',
          unit_amount: minorAmount,
          product_data: {
            name: trim(event?.course_name) || 'Course booking',
            description: description.slice(0, 500) || undefined,
          },
        },
      },
    ],
    metadata,
    payment_intent_data: {
      description: description.slice(0, 1000) || 'Admin booking payment',
      ...(primary.email ? { receipt_email: trim(primary.email) } : {}),
      metadata,
    },
  });

  if (!checkoutSession?.url) {
    const err = new Error('Stripe did not return a payment link URL');
    err.status = 502;
    throw err;
  }

  const createdAt = nowMysql();
  const responseDump = JSON.stringify({
    checkout_session_id: checkoutSession.id,
    url: checkoutSession.url,
    expires_at: expiresAt.toISOString(),
    expire_minutes: quotedMinutes,
    email_delivery_buffer_seconds: 30,
  });

  for (let i = 0; i < bookingIds.length; i += 1) {
    const bookingId = bookingIds[i];
    const lineAmount = chargeAmountForAttendee(attendees[i] || {}, showCancellation);
    await upsertSingleBookingPayment(pool, {
      bookingId,
      paymentType: PENDING_PAYMENT_TYPE,
      transactionId: checkoutSession.id,
      amount: lineAmount,
      transationType: 'pending_link',
      response: responseDump,
      created: createdAt,
    });
  }

  const payload = {
    checkout_session_id: checkoutSession.id,
    url: checkoutSession.url,
    expires_at: expiresAt.toISOString(),
    expire_minutes: quotedMinutes,
    amount,
    currency: 'gbp',
    booking_ids: bookingIds,
    booking_refs: bookingRefs,
    event_id: eventId,
    cart_id: cartId,
    status: 'open',
    email_sent: false,
  };

  const emailResult = await sendAdminStripePaymentLinkEmail({
    to: primary.email,
    customerName: primaryName,
    courseName: event?.course_name,
    amountLabel: formatAmountLabel(amount, 'gbp'),
    paymentUrl: checkoutSession.url,
    expireMinutes: quotedMinutes,
    bookingRefs: bookingRefs.join(', '),
  });
  payload.email_sent = Boolean(emailResult?.sent);
  if (!emailResult?.sent) {
    console.warn(
      '[ADMIN][STRIPE_LINK] Payment link email not sent:',
      emailResult?.reason || 'unknown'
    );
  }

  if (session) {
    session.stripePaymentLink = payload;
  }

  return payload;
}

async function getAdminStripePaymentLink(pool, session) {
  const stored = session?.stripePaymentLink;
  if (!stored?.checkout_session_id) {
    const err = new Error('No Stripe payment link is waiting for this booking');
    err.status = 400;
    throw err;
  }

  let stripeStatus = stored.status || 'open';
  let paymentStatus = 'unpaid';
  try {
    const live = await stripe.checkout.sessions.retrieve(stored.checkout_session_id);
    stripeStatus = live.status || stripeStatus;
    paymentStatus = live.payment_status || paymentStatus;
  } catch (err) {
    console.error('[ADMIN][STRIPE_LINK] retrieve failed', err.message);
  }

  const [bookingRows] = await pool.query(
    `SELECT id, status FROM bookings WHERE id IN (${stored.booking_ids.map(() => '?').join(',')})`,
    stored.booking_ids
  );
  const paid = (bookingRows || []).some((row) => Number(row.status) === 1);
  const missing = (bookingRows || []).length === 0;
  const expiredByTime =
    stored.expires_at && new Date(stored.expires_at).getTime() <= Date.now();

  let status = 'open';
  if (paid || paymentStatus === 'paid') status = 'paid';
  else if (missing || stripeStatus === 'expired' || expiredByTime) status = 'expired';

  const nextUrl =
    status === 'paid'
      ? `/admin/bookings/confirmation?evId=${stored.event_id}&cartId=${encodeURIComponent(stored.cart_id)}`
      : null;

  return {
    ...stored,
    status,
    stripe_status: stripeStatus,
    payment_status: paymentStatus,
    next_url: nextUrl,
  };
}

async function confirmAdminStripePaymentLink(pool, source) {
  const metadata = source?.metadata || {};
  if (!isAdminPaymentLink(metadata)) return { skipped: true };

  const bookingIds = parseBookingIds(metadata);
  if (!bookingIds.length) {
    console.warn('[ADMIN][STRIPE_LINK] confirm with no booking ids', metadata);
    return { skipped: true };
  }

  const paymentIntentId =
    trim(source.payment_intent) ||
    (typeof source.id === 'string' && source.id.startsWith('pi_') ? source.id : '') ||
    trim(source.payment_intent_id);
  let checkoutSessionId =
    (typeof source.id === 'string' && source.id.startsWith('cs_') ? source.id : '') ||
    trim(source.checkout_session_id);
  const processedAt = nowMysql();

  let lastLockId = 0;
  const mailBookingIds = [];

  for (const bookingId of bookingIds) {
    const [bookingRows] = await pool.query(
      'SELECT * FROM bookings WHERE id = ? LIMIT 1',
      [bookingId]
    );
    const booking = bookingRows?.[0];
    if (!booking) continue;

    lastLockId = Number(booking.lockid) || lastLockId;
    const amt = Number(booking.admin_payment_received) || 0;
    const alreadyConfirmed = Number(booking.status) === 1;

    if (!checkoutSessionId) {
      const [pendingLink] = await pool.query(
        `SELECT transation_id FROM booking_payments
         WHERE booking_id = ? AND payment_type = ?
         LIMIT 1`,
        [bookingId, PENDING_PAYMENT_TYPE]
      );
      const pendingTxn = trim(pendingLink?.[0]?.transation_id);
      if (pendingTxn.startsWith('cs_')) checkoutSessionId = pendingTxn;
    }

    const transactionId = paymentIntentId || checkoutSessionId;
    const responseDump = JSON.stringify({
      checkout_session_id: checkoutSessionId || null,
      payment_intent: paymentIntentId || null,
      payment_status: source.payment_status || 'paid',
      metadata,
    });

    if (!alreadyConfirmed) {
      const [eventRows] = await pool.query(
        'SELECT * FROM course_events WHERE id = ? LIMIT 1',
        [booking.course_event_id]
      );
      const eventData = eventRows?.[0];
      if (!eventData) continue;

      if (Number(eventData.bookings_done) >= Number(eventData.booking_limit)) {
        await pool.query(
          `UPDATE bookings
           SET refundable = 1, payment_due = GREATEST(payment_due - ?, 0), status = 1, modified = ?
           WHERE id = ?`,
          [amt, processedAt, bookingId]
        );
      } else {
        const [lockRows] = await pool.query(
          'SELECT id FROM lock_bookings WHERE id = ? LIMIT 1',
          [booking.lockid || 0]
        );
        const lockExists = Boolean(lockRows?.[0]);
        const [attendeeRows] = await pool.query(
          'SELECT vehicle_type FROM booking_attendees WHERE booking_id = ? LIMIT 1',
          [bookingId]
        );
        const vehicleType = Number(attendeeRows?.[0]?.vehicle_type);

        if (!lockExists && vehicleType !== 3) {
          const [linkedEvents] = await pool.query(
            'SELECT * FROM course_events WHERE parent = ?',
            [eventData.parent]
          );
          for (const edata of linkedEvents || []) {
            let svM = Number(edata.manual_lock_done || 0);
            let svA = Number(edata.automatic_lock_done || 0);
            if (vehicleType === 1) svA += Number(booking.spaces) || 1;
            else if (vehicleType === 0) svM += Number(booking.spaces) || 1;
            await pool.query(
              'UPDATE course_events SET manual_lock_done = ?, automatic_lock_done = ? WHERE id = ?',
              [svM, svA, edata.id]
            );
          }
        }

        await pool.query(
          'UPDATE course_events SET bookings_done = bookings_done + ? WHERE parent = ?',
          [Number(booking.spaces) || 1, eventData.parent]
        );
        await pool.query(
          `UPDATE bookings
           SET payment_due = GREATEST(payment_due - ?, 0), status = 1, modified = ?
           WHERE id = ?`,
          [amt, processedAt, bookingId]
        );
      }

      mailBookingIds.push(bookingId);
    }

    await upsertSingleBookingPayment(pool, {
      bookingId,
      paymentType: 'SALE',
      transactionId: transactionId || checkoutSessionId,
      amount: amt,
      transationType: 'booking',
      response: responseDump,
      created: processedAt,
    });
  }

  if (lastLockId) {
    await removeLockById(pool, lastLockId, false);
  }

  for (const bookingId of mailBookingIds) {
    try {
      await sendAdminBookingConfirmationEmail(pool, bookingId);
    } catch (emailError) {
      console.error(
        `[ADMIN][STRIPE_LINK] confirmation email failed for booking ${bookingId}:`,
        emailError
      );
    }
  }

  return {
    success: true,
    booking_ids: bookingIds,
    confirmed: mailBookingIds.length,
  };
}

async function expireAdminStripeCheckoutSession(sessionId) {
  const id = trim(sessionId);
  if (!id) return { expired: false };
  try {
    const live = await stripe.checkout.sessions.retrieve(id);
    if (live.status === 'expired') return { expired: true, already: true };
    if (live.payment_status === 'paid') return { expired: false, paid: true, session: live };
    await stripe.checkout.sessions.expire(id);
    return { expired: true };
  } catch (err) {
    const code = err?.code || err?.raw?.code;
    if (code === 'checkout_session_already_expired' || /already expired/i.test(err.message || '')) {
      return { expired: true, already: true };
    }
    console.error('[ADMIN][STRIPE_LINK] expire session failed', id, err.message);
    return { expired: false, error: err.message };
  }
}

async function expireAdminStripePaymentLink(pool, source, session) {
  const metadata = source?.metadata || {};
  const bookingIds = parseBookingIds(metadata);
  const checkoutSessionId =
    (typeof source?.id === 'string' && source.id.startsWith('cs_') ? source.id : '') ||
    trim(source?.checkout_session_id) ||
    trim(session?.stripePaymentLink?.checkout_session_id);

  if (checkoutSessionId) {
    const result = await expireAdminStripeCheckoutSession(checkoutSessionId);
    if (result.paid && result.session) {
      await confirmAdminStripePaymentLink(pool, result.session);
      return { expired: false, paid: true };
    }
  }

  const ids = bookingIds.length
    ? bookingIds
    : session?.stripePaymentLink?.booking_ids || [];
  return cancelUnpaidAdminStripeBookings(pool, ids, session);
}

async function expireDueAdminStripePaymentLinks(pool) {
  const fallbackMinutes = getExpireMinutes();
  const [rows] = await pool.query(
    `SELECT bp.transation_id AS checkout_session_id,
            MAX(bp.response) AS response,
            MIN(bp.created) AS created,
            GROUP_CONCAT(DISTINCT bp.booking_id) AS booking_ids
     FROM booking_payments bp
     INNER JOIN bookings b ON b.id = bp.booking_id
     WHERE bp.payment_type = ?
       AND bp.isDelete = 0
       AND b.status = 0
     GROUP BY bp.transation_id`,
    [PENDING_PAYMENT_TYPE]
  );

  if (!rows?.length) return { expired: 0 };

  const now = Date.now();
  let expired = 0;
  for (const row of rows) {
    let expiresMs = null;
    try {
      const parsed =
        typeof row.response === 'string' ? JSON.parse(row.response) : row.response;
      if (parsed?.expires_at) {
        const ms = Date.parse(parsed.expires_at);
        if (Number.isFinite(ms)) expiresMs = ms;
      }
    } catch {
      expiresMs = null;
    }
    if (!expiresMs) {
      const created = parseMysqlDateTime(row.created);
      if (created) {
        expiresMs = created.getTime() + fallbackMinutes * 60 * 1000;
      }
    }
    if (!expiresMs || expiresMs > now) continue;

    const bookingIds = String(row.booking_ids || '')
      .split(',')
      .map((id) => Number.parseInt(id, 10))
      .filter(Boolean);
    const result = await expireAdminStripePaymentLink(pool, {
      id: row.checkout_session_id,
      metadata: {
        type: METADATA_TYPE,
        booking_ids: bookingIds.join(','),
      },
    });
    if (result?.cancelled || result?.expired) expired += 1;
  }

  return { expired };
}

module.exports = {
  METADATA_TYPE,
  PENDING_PAYMENT_TYPE,
  isAdminPaymentLink,
  getExpireMinutes,
  createAdminStripePaymentLink,
  getAdminStripePaymentLink,
  confirmAdminStripePaymentLink,
  expireAdminStripePaymentLink,
  expireDueAdminStripePaymentLinks,
  cancelUnpaidAdminStripeBookings,
};
