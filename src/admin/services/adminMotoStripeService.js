/**
 * Admin MOTO card payments use Stripe PaymentIntents.
 * Legacy admin MOTO used WorldPay — intentional deviation.
 */
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const {
  saveBookingCompleteWorld,
  addBookingsDone,
  getLockBooking,
  requireAdminBookingSession,
} = require('./bookingWizardService');
const { removeCurLock } = require('./bookingDetailsService');

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function getPublishableKey() {
  return trim(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
}

function getAdminUsername(req) {
  const admin = req.session?.loggedinAdmin;
  return trim(admin?.admin_username || admin?.admin_email || '');
}

function getMotoBookingIds(req) {
  const ids = req.session?.worldPaymentBookings || req.session?.motoPaymentBookings || [];
  return (ids || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
}

function computeMotoChargeFromSession(req) {
  const adminBooking = requireAdminBookingSession(req);
  const bookingIds = getMotoBookingIds(req);
  const bookingData = adminBooking?.Booking_data;

  if (!adminBooking || !bookingIds.length || !bookingData) {
    return null;
  }

  let totAmount = 0;
  let emailAddress = '';
  let customerName = '';
  let phoneNumber = '';
  let cartId = '';
  const bookingRefs = [];

  for (const bd of Object.values(bookingData)) {
    if (!bd || typeof bd !== 'object') {
      continue;
    }
    emailAddress = bd.email || emailAddress;
    customerName = `${trim(bd.first_name)} ${trim(bd.sur_name)}`.trim() || customerName;
    phoneNumber = bd.contact1 || phoneNumber;
    const outstanding = Number(bd.amount_outstanding) || 0;
    const courseCost = Number(bd.course_cost) || 0;
    const paymentReceived = Number(bd.payment_received) || 0;
    totAmount += outstanding > 0 ? courseCost - outstanding : paymentReceived;
    if (bd.booking_ref) {
      bookingRefs.push(String(bd.booking_ref));
      cartId += `${bd.booking_ref}-`;
    }
  }
  cartId = cartId.replace(/-$/, '');

  return {
    totAmount,
    emailAddress: trim(emailAddress),
    customerName,
    phoneNumber,
    cartId,
    bookingRefs,
    bookingIds,
    evId: Number(adminBooking.eventId),
    spaceRequired: Number(adminBooking.space_required) || bookingIds.length,
    lockId: Number(adminBooking.lock_session?.id) || 0,
    adminUsername: getAdminUsername(req),
  };
}

async function paymentAlreadyProcessed(pool, paymentIntentId) {
  const [rows] = await pool.query(
    'SELECT id FROM booking_payments WHERE transation_id = ? LIMIT 1',
    [paymentIntentId]
  );
  return rows.length > 0;
}

async function finalizeAdminMotoStripePayment(pool, options) {
  const paymentIntent = options.paymentIntent;
  const paymentIntentId = paymentIntent?.id || options.paymentIntentId;
  if (!paymentIntentId) {
    return { ok: false, message: 'Missing payment intent id' };
  }

  const metadata = paymentIntent?.metadata || options.metadata || {};
  const bookingIds = (metadata.booking_ids || options.bookingIds || '')
    .toString()
    .split(',')
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);

  if (!bookingIds.length) {
    return { ok: false, message: 'No bookings found for payment' };
  }

  if (await paymentAlreadyProcessed(pool, paymentIntentId)) {
    return { ok: true, alreadyProcessed: true, evId: Number(metadata.evId || metadata.course_event_id) };
  }

  const [statusRows] = await pool.query(
    `SELECT id, status FROM bookings WHERE id IN (${bookingIds.map(() => '?').join(',')})`,
    bookingIds
  );
  const allConfirmed =
    statusRows.length === bookingIds.length &&
    statusRows.every((row) => Number(row.status) === 1);
  if (allConfirmed) {
    return { ok: true, alreadyProcessed: true, evId: Number(metadata.evId || metadata.course_event_id) };
  }

  for (const bookingId of bookingIds) {
    const row = statusRows.find((item) => Number(item.id) === Number(bookingId));
    if (row && Number(row.status) === 1) {
      continue;
    }
    await saveBookingCompleteWorld(pool, bookingId, {
      type: 'STRIPE',
      transation_id: paymentIntentId,
      response: JSON.stringify({
        payment_intent: paymentIntentId,
        payment_status: paymentIntent?.status || 'succeeded',
        source: 'admin_moto',
      }),
    });
  }

  const evId = Number(metadata.evId || metadata.course_event_id || options.evId);
  const spaceRequired =
    Number(metadata.space_required || options.spaceRequired) || bookingIds.length;
  const lockId = Number(metadata.lock_id || options.lockId) || 0;

  if (options.req?.session) {
    await addBookingsDone(pool, options.req, evId, spaceRequired);
  } else if (evId && spaceRequired > 0) {
    const [parentRows] = await pool.query(
      'SELECT parent FROM course_events WHERE id = ? LIMIT 1',
      [evId]
    );
    const parent = parentRows[0]?.parent ?? evId;
    await pool.query(
      'UPDATE course_events SET bookings_done = bookings_done + ? WHERE parent = ?',
      [spaceRequired, parent]
    );

    if (lockId) {
      const fakeSession = { adminBooking: { lock_session: await getLockBooking(pool, lockId) } };
      if (fakeSession.adminBooking.lock_session?.id) {
        await removeCurLock(pool, fakeSession, null, false);
      }
    } else {
      const [lockRows] = await pool.query(
        `SELECT lockid FROM bookings WHERE id IN (${bookingIds.map(() => '?').join(',')}) LIMIT 1`,
        bookingIds
      );
      const bookingLockId = Number(lockRows[0]?.lockid);
      if (bookingLockId) {
        const fakeSession = { adminBooking: { lock_session: await getLockBooking(pool, bookingLockId) } };
        if (fakeSession.adminBooking.lock_session?.id) {
          await removeCurLock(pool, fakeSession, null, false);
        }
      }
    }
  }

  return { ok: true, evId, bookingIds };
}

async function createAdminMotoStripeIntent(pool, req) {
  const charge = computeMotoChargeFromSession(req);
  if (!charge) {
    return {
      ok: false,
      message: 'Error on payment process, Try Again',
      redirect: '/admin/dashboard',
    };
  }

  if (charge.totAmount <= 0) {
    return { ok: false, message: 'Payment amount must be greater than zero' };
  }

  const publishableKey = getPublishableKey();
  if (!trim(process.env.STRIPE_SECRET_KEY) || !publishableKey) {
    return { ok: false, message: 'Stripe is not configured' };
  }

  const amountPence = Math.round(charge.totAmount * 100);
  const description =
    charge.cartId ||
    charge.bookingRefs.join('-') ||
    `Admin MOTO booking event ${charge.evId}`;

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountPence,
    currency: 'gbp',
    automatic_payment_methods: { enabled: true },
    metadata: {
      source: 'admin_moto',
      booking_ids: charge.bookingIds.join(','),
      booking_refs: charge.bookingRefs.join(','),
      course_event_id: String(charge.evId),
      evId: String(charge.evId),
      space_required: String(charge.spaceRequired),
      lock_id: String(charge.lockId || ''),
      admin_username: charge.adminUsername,
    },
    description,
    receipt_email: charge.emailAddress || undefined,
  });

  req.session.adminMotoStripe = {
    payment_intent_id: paymentIntent.id,
    evId: charge.evId,
  };

  return {
    ok: true,
    data: {
      clientSecret: paymentIntent.client_secret,
      publishableKey,
      amount: charge.totAmount,
      evId: charge.evId,
    },
  };
}

async function confirmAdminMotoStripePayment(pool, req, paymentIntentId) {
  const sessionIntentId = req.session?.adminMotoStripe?.payment_intent_id;
  const bookingIds = getMotoBookingIds(req);
  const adminBooking = requireAdminBookingSession(req);

  if (!adminBooking || !bookingIds.length) {
    return {
      ok: false,
      message: 'Error on payment process, Try Again',
      redirect: '/admin/dashboard',
    };
  }

  if (!paymentIntentId || paymentIntentId !== sessionIntentId) {
    return { ok: false, message: 'Invalid payment session' };
  }

  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (paymentIntent.status !== 'succeeded') {
    return { ok: false, message: 'Payment has not completed successfully' };
  }

  const result = await finalizeAdminMotoStripePayment(pool, {
    paymentIntent,
    req,
  });

  if (!result.ok) {
    return result;
  }

  const evId =
    result.evId ||
    Number(req.session?.adminMotoStripe?.evId) ||
    Number(paymentIntent.metadata?.evId);

  delete req.session.adminMotoStripe;

  return {
    ok: true,
    redirect: `/admin/bookings/confirmation/cash?evId=${evId}`,
    evId,
  };
}

async function finalizeAdminMotoFromWebhook(pool, paymentIntent) {
  if (paymentIntent.metadata?.source !== 'admin_moto') {
    return { ok: false, message: 'Not an admin MOTO payment' };
  }
  return finalizeAdminMotoStripePayment(pool, { paymentIntent });
}

module.exports = {
  computeMotoChargeFromSession,
  createAdminMotoStripeIntent,
  confirmAdminMotoStripePayment,
  finalizeAdminMotoStripePayment,
  finalizeAdminMotoFromWebhook,
};
