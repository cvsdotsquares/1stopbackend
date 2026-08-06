/**
 * Admin add-booking WorldPay flow (legacy WorldPaymentForm.php parity).
 */
const {
  buildWorldpaySignature,
  createAccessHostedPayment,
  formatWorldpayAmount,
  getAdminFrontendBase,
  getApiPublicBase,
  getMotoHppCustomisationId,
  getWorldpayCurrency,
  getWorldpayPurchaseUrl,
  getWorldpayTestMode,
  getEnvWorldpayCredentials,
  hasAccessCredentials,
  isMockMode,
  isWorldpayTestEnvironment,
  pickCallbackField,
  resolveMotoIntegrationMode,
} = require('./motoPaymentService');

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function nowMysql() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function getBookingWorldpayCredentials() {
  const envCreds = getEnvWorldpayCredentials();
  if (envCreds.instId && envCreds.accId) {
    return envCreds;
  }
  return {
    instId: isWorldpayTestEnvironment() ? '1382788' : '1461358',
    accId: '1STOPINSTRUCM2',
  };
}

function calculateAttendeeWorldpayAmount(attendee, showCancellation) {
  const courseCost = Number(attendee.course_cost) || 0;
  const paymentReceived = Number(attendee.payment_received) || 0;
  const amountOutstanding = Number(attendee.amount_outstanding) || 0;

  if (amountOutstanding > 0) {
    return courseCost - amountOutstanding;
  }
  return showCancellation ? courseCost : paymentReceived;
}

async function getEventContext(pool, eventId) {
  const [rows] = await pool.query(
    `SELECT ce.*, c.course_name, c.description, l.location_name,
            l.address1, l.address2, l.address3, l.address4, l.postcode,
            f.franchise_name, f.vat AS franchise_vat
     FROM course_events ce
     LEFT JOIN courses c ON c.id = ce.course_id
     LEFT JOIN locations l ON l.id = ce.location_id
     LEFT JOIN franchise f ON f.id = ce.franchise_id
     WHERE ce.id = ?
     LIMIT 1`,
    [eventId]
  );
  return rows?.[0] || null;
}

function buildEventDatesMap(dateRows) {
  const dates = {};
  let hasTbc = false;
  for (const row of dateRows || []) {
    const raw = row.event_date;
    if (raw && String(raw).slice(0, 10) !== '0000-00-00') {
      dates[String(raw).slice(0, 10)] =
        `${row.event_start_time || ''} - ${row.event_end_time || ''}`;
    } else {
      hasTbc = true;
    }
  }
  if (hasTbc) dates.TBC = '';
  return dates;
}

function showDepositCancellationWarning(event, dates) {
  const schoolDeposit = Number(event.school_deposit_price) || 0;
  const isDeposit = Number(event.is_deposit) || 0;
  if (!(schoolDeposit > 0 && isDeposit > 0)) return false;
  const keys = Object.keys(dates || {}).filter((k) => k !== 'TBC');
  if (!keys.length) return false;
  const firstDate = keys.sort()[0];
  const depositPeriod =
    Number(event.deposit_days ?? event.cancel_days ?? 0) || 0;
  const depositCalDate = new Date();
  depositCalDate.setDate(depositCalDate.getDate() + depositPeriod + 1);
  return depositCalDate.toISOString().slice(0, 10) > firstDate;
}

async function removeLockById(pool, lockId, revertVehicleCounts = true) {
  const id = Number(lockId);
  if (!Number.isFinite(id) || id <= 0) return false;

  const [lockRows] = await pool.query(
    'SELECT * FROM lock_bookings WHERE id = ? LIMIT 1',
    [id]
  );
  const lockData = lockRows?.[0];
  if (!lockData) return false;

  const [deleteResult] = await pool.query(
    'DELETE FROM lock_bookings WHERE id = ?',
    [id]
  );
  if (!deleteResult?.affectedRows) return false;

  const [eventsData] = await pool.query(
    'SELECT * FROM course_events WHERE parent = ?',
    [lockData.parent]
  );

  for (const edata of eventsData || []) {
    if (revertVehicleCounts) {
      const svM =
        Number(edata.manual_lock_done || 0) - Number(lockData.manual_lock || 0);
      const svA =
        Number(edata.automatic_lock_done || 0) -
        Number(lockData.automatic_lock || 0);
      await pool.query(
        'UPDATE course_events SET manual_lock_done = ?, automatic_lock_done = ? WHERE id = ?',
        [svM, svA, edata.id]
      );
    }
    await pool.query(
      'UPDATE course_events SET current_locks = current_locks - ? WHERE id = ? AND current_locks > 0',
      [lockData.space_required, edata.id]
    );
  }

  return true;
}

function requireWorldpayBookingSession(session) {
  const bookingIds = session?.worldPaymentBookings;
  if (!Array.isArray(bookingIds) || !bookingIds.length) {
    const err = new Error('Error on payment process, Try Again');
    err.status = 400;
    throw err;
  }
  const adminBooking = session?.adminBooking;
  if (!adminBooking?.eventId) {
    const err = new Error('Booking session expired');
    err.status = 400;
    throw err;
  }
  return { bookingIds, adminBooking };
}

async function resolveBookingRefs(pool, bookingIds) {
  const refs = [];
  for (const bookingId of bookingIds) {
    const [rows] = await pool.query(
      `SELECT booking_ref FROM booking_attendees WHERE booking_id = ? LIMIT 1`,
      [bookingId]
    );
    const ref = rows?.[0]?.booking_ref;
    if (!ref) {
      const err = new Error('Booking reference missing');
      err.status = 400;
      throw err;
    }
    refs.push(ref);
  }
  return refs;
}

async function getBookingWorldpayPayload(pool, session) {
  const { bookingIds, adminBooking } = requireWorldpayBookingSession(session);
  const evId = Number(adminBooking.eventId);
  const event = await getEventContext(pool, evId);
  if (!event) {
    const err = new Error('Invalid course, Try again');
    err.status = 404;
    throw err;
  }

  const [dateRows] = await pool.query(
    `SELECT event_date, event_start_time, event_end_time
     FROM course_event_dates WHERE course_event_id = ? ORDER BY event_date ASC`,
    [evId]
  );
  const dates = buildEventDatesMap(dateRows);
  const showCancellation = showDepositCancellationWarning(event, dates);
  const submitted = adminBooking.Booking_data || {};

  const bookingRefs = await resolveBookingRefs(pool, bookingIds);
  let totAmount = 0;
  let emailAddress = '';
  let customerName = '';
  let phoneNumber = '';

  for (let i = 0; i < bookingIds.length; i += 1) {
    const key = String(i + 1);
    const row = submitted[key] || submitted[i + 1] || {};
    if (typeof row === 'object') {
      totAmount += calculateAttendeeWorldpayAmount(row, showCancellation);
      if (!emailAddress && row.email) emailAddress = trim(row.email);
      if (!customerName && (row.first_name || row.sur_name)) {
        customerName = `${trim(row.first_name)} ${trim(row.sur_name)}`.trim();
      }
      if (!phoneNumber && row.contact1) phoneNumber = trim(row.contact1);
    }
  }

  if (totAmount <= 0) {
    const err = new Error('Payment amount must be greater than zero');
    err.status = 400;
    throw err;
  }

  const cartId = bookingRefs.join('-');
  const apiBase = getApiPublicBase();
  const adminBase = getAdminFrontendBase();
  const currency = getWorldpayCurrency();
  const amountStr = formatWorldpayAmount(totAmount);
  const notifyUrl = `${apiBase}/api/admin/bookings/wizard/worldpay/notify`;
  const completeUrl = `${apiBase}/api/admin/bookings/wizard/worldpay/complete`;
  const cancelUrl = `${apiBase}/api/admin/bookings/wizard/worldpay/cancel`;
  const failedUrl = `${adminBase}/admin/bookings/worldpay/failed?evId=${evId}&cartId=${encodeURIComponent(cartId)}`;
  const returnUrl = `${adminBase}/admin/bookings/worldpay/return?evId=${evId}&cartId=${encodeURIComponent(cartId)}`;

  if (isMockMode()) {
    return {
      mock: true,
      event_id: evId,
      cart_id: cartId,
      amount: totAmount,
      currency,
      result_url: `${returnUrl}&status=success&transStatus=Y&mock=1&M_evId=${evId}`,
      message:
        'WORLDPAY_MOCK_MODE is on — simulating WorldPay redirect. Set WORLDPAY_MOCK_MODE=false for the real payment page.',
    };
  }

  const integration = resolveMotoIntegrationMode();
  if (integration === 'access_hpp') {
    if (!hasAccessCredentials()) {
      const err = new Error(
        'Access WorldPay credentials are not configured (WORLDPAY_ACCESS_USERNAME / PASSWORD / ENTITY)'
      );
      err.status = 400;
      throw err;
    }

    const description = trim(event.course_name) || '1 Stop Booking';
    const bookingDisable3ds =
      process.env.WORLDPAY_HPP_DISABLE_3DS_BOOKING ??
      process.env.WORLDPAY_HPP_DISABLE_3DS ??
      'true';
    const { redirectUrl } = await createAccessHostedPayment({
      orderId: cartId,
      amount: totAmount,
      currency,
      description,
      payeeName: customerName,
      payeeEmail: emailAddress,
      resultUrls: {
        successURL: `${completeUrl}?status=success&cartId=${encodeURIComponent(cartId)}&M_evId=${evId}`,
        cancelURL: `${cancelUrl}?status=cancel&cartId=${encodeURIComponent(cartId)}&M_evId=${evId}`,
        failureURL: failedUrl,
        errorURL: failedUrl,
        pendingURL: `${completeUrl}?status=pending&cartId=${encodeURIComponent(cartId)}&M_evId=${evId}`,
        expiryURL: `${cancelUrl}?status=expiry&cartId=${encodeURIComponent(cartId)}&M_evId=${evId}`,
      },
      options: {
        moto: true,
        customisationId: getMotoHppCustomisationId(),
        disable3ds:
          String(bookingDisable3ds).toLowerCase() !== 'false',
        disableFraud:
          String(process.env.WORLDPAY_HPP_DISABLE_FRAUD || 'true').toLowerCase() !==
          'false',
      },
    });

    return {
      mock: false,
      integration: 'access_hpp',
      event_id: evId,
      cart_id: cartId,
      amount: totAmount,
      currency,
      redirect_url: redirectUrl,
      message: 'Redirecting to WorldPay Hosted Payment Pages',
    };
  }

  const { instId, accId } = getBookingWorldpayCredentials();
  const { signatureFields, signature } = buildWorldpaySignature({
    instId,
    accId,
    amount: amountStr,
    cartId,
    currency,
  });

  return {
    mock: false,
    integration: 'payment_pages',
    event_id: evId,
    cart_id: cartId,
    amount: totAmount,
    currency,
    purchase_url: getWorldpayPurchaseUrl(),
    fields: {
      testMode: getWorldpayTestMode(),
      instId,
      cartId,
      amount: amountStr,
      cancelURL: cancelUrl,
      successURL: completeUrl,
      failureURL: failedUrl,
      errorURL: failedUrl,
      email: emailAddress,
      name: customerName,
      country: 'GB',
      currency,
      hideCurrency: 'true',
      desc: '1 Stop Booking',
      accId1: accId,
      tel: phoneNumber,
      MC_CancelURL: cancelUrl,
      MC_callback: notifyUrl,
      M_paymentType: 'course_booking',
      M_voucherId: '0',
      M_evId: String(evId),
      signatureFields,
      signature,
    },
    message: 'Redirecting to WorldPay payment page',
  };
}

function isWorldpayAuthorised(body) {
  const transStatus = pickCallbackField(body, 'transStatus', 'transstatus', 'outcome');
  const statusHint = pickCallbackField(body, 'status');
  const mock = pickCallbackField(body, 'mock');
  if (mock === '1' || statusHint === 'success') return true;
  const statusUpper = transStatus.toUpperCase();
  return (
    statusUpper === 'Y' ||
    statusUpper === 'AUTHORIZED' ||
    statusUpper === 'AUTHORISED' ||
    statusUpper === 'SENT_FOR_SETTLEMENT' ||
    statusUpper === 'SUCCESS'
  );
}

async function buildCartIdFromSession(pool, session) {
  const bookingIds = session?.worldPaymentBookings || [];
  if (!bookingIds.length) return '';
  const refs = await resolveBookingRefs(pool, bookingIds);
  return refs.join('-');
}

async function getBookingConfirmationDetails(pool, { evId, cartId } = {}) {
  let bookingIds = [];
  if (cartId) {
    bookingIds = await resolveBookingIdsFromCartId(pool, cartId);
  }

  if (!bookingIds.length) {
    return { event_id: evId || null, bookings: [] };
  }

  const bookings = [];
  for (const bookingId of bookingIds) {
    const [rows] = await pool.query(
      `SELECT b.id, b.status, b.payment_due, b.admin_payment_received, b.total_amount,
              b.type_of_book, b.created,
              ba.booking_ref, ba.first_name, ba.sur_name, ba.email, ba.contact1,
              ba.vehicle_type, ba.license_number,
              c.course_name, ce.id AS course_event_id,
              l.location_name
       FROM bookings b
       JOIN booking_attendees ba ON ba.booking_id = b.id
       JOIN course_events ce ON ce.id = b.course_event_id
       JOIN courses c ON c.id = b.course_id
       LEFT JOIN locations l ON l.id = ce.location_id
       WHERE b.id = ?
       LIMIT 1`,
      [bookingId]
    );
    if (rows?.[0]) bookings.push(rows[0]);
  }

  const resolvedEvId =
    evId || bookings[0]?.course_event_id || null;

  return {
    event_id: resolvedEvId,
    bookings: bookings.map((row) => ({
      id: row.id,
      booking_ref: row.booking_ref,
      status: Number(row.status),
      pupil: `${row.first_name || ''} ${row.sur_name || ''}`.trim(),
      email: row.email || '',
      contact1: row.contact1 || '',
      course_name: row.course_name || '',
      location_name: row.location_name || '',
      payment_received: Number(row.admin_payment_received) || 0,
      payment_due: Number(row.payment_due) || 0,
      total_amount: Number(row.total_amount) || 0,
      created: row.created,
    })),
  };
}

async function completeBookingWorldpayNotify(pool, body) {
  const paymentType = pickCallbackField(body, 'M_paymentType', 'm_paymenttype');
  if (paymentType && paymentType !== 'course_booking') {
    return { success: false, skipped: true, message: 'Not a course booking payment' };
  }

  if (!isWorldpayAuthorised(body)) {
    return { success: false, message: 'Payment was not authorised' };
  }

  const cartId = pickCallbackField(
    body,
    'cartId',
    'cartid',
    'transactionReference'
  );
  const orderKey = pickCallbackField(body, 'transId', 'transid', 'paymentId');
  const transactionType =
    pickCallbackField(body, 'transaction_type') || 'SALE';
  const refs = await bookingRefsFromCartId(pool, cartId);
  if (!refs.length) {
    const err = new Error('Missing booking reference');
    err.status = 400;
    throw err;
  }

  const processedAt = nowMysql();
  const responseDump = JSON.stringify(body);
  let lastLockId = 0;
  const mailBookingIds = [];

  for (const bookingRef of refs) {
    const [attendeeRows] = await pool.query(
      `SELECT booking_id, vehicle_type FROM booking_attendees WHERE booking_ref = ? LIMIT 1`,
      [bookingRef]
    );
    const attendee = attendeeRows?.[0];
    if (!attendee?.booking_id) continue;

    const bookingId = attendee.booking_id;
    const [bookingRows] = await pool.query(
      'SELECT * FROM bookings WHERE id = ? LIMIT 1',
      [bookingId]
    );
    const booking = bookingRows?.[0];
    if (!booking) continue;

    if (Number(booking.status) === 1) {
      lastLockId = Number(booking.lockid) || lastLockId;
      continue;
    }

    const confirmedBookingId = bookingId;

    const [eventRows] = await pool.query(
      'SELECT * FROM course_events WHERE id = ? LIMIT 1',
      [booking.course_event_id]
    );
    const eventData = eventRows?.[0];
    if (!eventData) continue;

    const amt = Number(booking.admin_payment_received) || 0;
    lastLockId = Number(booking.lockid) || lastLockId;

    if (Number(eventData.bookings_done) >= Number(eventData.booking_limit)) {
      if (booking.lockid) {
        await removeLockById(pool, booking.lockid, false);
      }
      await pool.query(
        `UPDATE bookings
         SET refundable = 1, payment_due = payment_due - ?, status = 1, modified = ?
         WHERE id = ?`,
        [amt, processedAt, bookingId]
      );
    } else {
      const [lockRows] = await pool.query(
        'SELECT id FROM lock_bookings WHERE id = ? LIMIT 1',
        [booking.lockid || 0]
      );
      const lockExists = Boolean(lockRows?.[0]);
      const vehicleType = Number(attendee.vehicle_type);

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
         SET payment_due = payment_due - ?, status = 1, modified = ?
         WHERE id = ?`,
        [amt, processedAt, bookingId]
      );
    }

    const [existingPayments] = await pool.query(
      `SELECT id FROM booking_payments
       WHERE booking_id = ? AND transation_id = ?
       LIMIT 1`,
      [bookingId, orderKey || cartId]
    );
    if (!existingPayments?.length) {
      await pool.query(
        `INSERT INTO booking_payments
          (booking_id, payment_type, transation_id, response, amount, created)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          bookingId,
          transactionType,
          orderKey || cartId,
          responseDump,
          amt,
          processedAt,
        ]
      );
    }

    mailBookingIds.push(confirmedBookingId);
  }

  if (lastLockId) {
    await removeLockById(pool, lastLockId, false);
  }

  const { sendAdminBookingConfirmationEmail } = require('./adminBookingEmailService');
  for (const bookingId of mailBookingIds) {
    await sendAdminBookingConfirmationEmail(pool, bookingId);
  }

  return { success: true, cart_id: cartId, message: 'Booking payment recorded' };
}

async function resolveBookingIdsFromCartId(pool, cartId) {
  const refs = await bookingRefsFromCartId(pool, cartId);
  const ids = [];
  for (const ref of refs) {
    const [rows] = await pool.query(
      'SELECT booking_id FROM booking_attendees WHERE booking_ref = ? LIMIT 1',
      [ref]
    );
    if (rows?.[0]?.booking_id) ids.push(rows[0].booking_id);
  }
  return ids;
}

async function cancelBookingWorldpay(pool, session, body = {}) {
  let bookingIds = session?.worldPaymentBookings || [];
  const cartId = pickCallbackField(body, 'cartId', 'cartid');

  if (!bookingIds.length && cartId) {
    bookingIds = await resolveBookingIdsFromCartId(pool, cartId);
  }

  for (const bookingId of bookingIds) {
    await pool.query('DELETE FROM booking_attendees WHERE booking_id = ?', [
      bookingId,
    ]);
    await pool.query('DELETE FROM booking_payments WHERE booking_id = ?', [
      bookingId,
    ]);
    await pool.query('DELETE FROM bookings WHERE id = ?', [bookingId]);
  }

  if (session?.adminBooking?.lock_session?.id) {
    await removeLockById(pool, session.adminBooking.lock_session.id, true);
  }

  if (session) {
    delete session.adminBooking;
    delete session.worldPaymentBookings;
    delete session.preFillData;
    delete session.courseEvent;
  }

  return {
    cancelled: true,
    message:
      'Your session has been timed out and your booking has been cancelled.',
  };
}

function clearBookingWorldpaySession(session) {
  if (!session) return null;
  const evId = session.adminBooking?.eventId || null;
  delete session.adminBooking;
  delete session.worldPaymentBookings;
  delete session.preFillData;
  delete session.courseEvent;
  return evId;
}

async function handleBookingWorldpayBrowserComplete(pool, session, body) {
  let cartId = pickCallbackField(
    body,
    'cartId',
    'cartid',
    'transactionReference'
  );

  let evId =
    Number(pickCallbackField(body, 'M_evId', 'evId')) ||
    Number(session?.adminBooking?.eventId) ||
    0;

  if (!cartId && session?.worldPaymentBookings?.length) {
    cartId = await buildCartIdFromSession(pool, session);
  }

  const shouldRecordPayment = isWorldpayAuthorised(body);

  if (shouldRecordPayment && cartId) {
    try {
      await completeBookingWorldpayNotify(pool, {
        ...body,
        cartId,
        transStatus: 'Y',
        M_paymentType: 'course_booking',
      });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][WORLDPAY][COMPLETE]', err.message);
    }
  }

  const clearedEvId = clearBookingWorldpaySession(session);
  if (clearedEvId) evId = Number(clearedEvId);

  const cartQuery = cartId ? `&cartId=${encodeURIComponent(cartId)}` : '';
  return {
    success: true,
    event_id: evId,
    cart_id: cartId,
    redirect_url: evId
      ? `/admin/bookings/confirmation?evId=${evId}${cartQuery}`
      : `/admin/bookings/confirmation${cartQuery ? `?${cartQuery.slice(1)}` : ''}`,
  };
}

async function bookingRefsFromCartId(pool, cartId) {
  const raw = trim(cartId);
  if (!raw) return [];
  return raw.includes('-') ? raw.split('-').map(trim).filter(Boolean) : [raw];
}

module.exports = {
  getBookingWorldpayPayload,
  completeBookingWorldpayNotify,
  cancelBookingWorldpay,
  handleBookingWorldpayBrowserComplete,
  getBookingConfirmationDetails,
};
