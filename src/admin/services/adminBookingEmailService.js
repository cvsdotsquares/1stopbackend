/**
 * Admin booking emails (legacy Booking class parity).
 */
const {
  sendBookingConfirmation,
  sendBookingRefundEmail,
  sendBookingDeleteEmail,
  sendBookingFeedbackEmail,
  resolveBookingBcc,
} = require('../../utils/emailService');
const { resolveBookingConfirmationRefSuffix } = require('../../utils/typeOfBook');

async function sendAdminBookingConfirmationEmail(pool, bookingId, options = {}) {
  const id = Number(bookingId);
  if (!Number.isFinite(id) || id <= 0) return { sent: false, reason: 'invalid_id' };

  const connection = await pool.getConnection();
  try {
    const [bookings] = await connection.query(
      `SELECT
         b.id, b.course_id, b.course_event_id, b.total_amount,
         b.payment_due, b.vat, b.total_fees, b.type_of_book, b.refundable,
         ba.booking_ref, ba.email
       FROM bookings b
       JOIN booking_attendees ba ON b.id = ba.booking_id
       WHERE b.id = ?
       ORDER BY ba.\`primary\` DESC, ba.id ASC
       LIMIT 1`,
      [id]
    );

    if (!bookings.length) {
      return { sent: false, reason: 'booking_not_found' };
    }

    const booking = bookings[0];
    const resendMode = Number(options.resendMode) || 0;
    const overrideEmail = String(options.overrideEmail || '').trim();
    const attendeeEmail = String(booking.email || '').trim();

    const [attendees] = await connection.query(
      `SELECT first_name, sur_name, email, contact1, contact2, contact3, vehicle_type
       FROM booking_attendees
       WHERE booking_id = ?`,
      [id]
    );

    const [courseData] = await connection.query(
      `SELECT email_content, course_name FROM courses WHERE id = ? LIMIT 1`,
      [booking.course_id]
    );

    const [locationData] = await connection.query(
      `SELECT location_name, address1, address2, address3, address4,
              postcode, direction_map, direction_content
       FROM locations
       WHERE id = (SELECT location_id FROM course_events WHERE id = ? LIMIT 1)
       LIMIT 1`,
      [booking.course_event_id]
    );

    const [eventDates] = await connection.query(
      `SELECT event_date, event_start_time, event_end_time
       FROM course_event_dates
       WHERE course_event_id = ?
       ORDER BY event_date ASC, event_start_time ASC`,
      [booking.course_event_id]
    );

    const [franchiseData] = await connection.query(
      `SELECT f.email_header, f.email_footer, f.email_logo, f.website,
              f.telephone, f.freephone, f.franchise_email
       FROM franchise f
       JOIN course_events ce ON ce.franchise_id = f.id
       WHERE ce.id = ?
       LIMIT 1`,
      [booking.course_event_id]
    );

    const [settingsData] = await connection.query(
      `SELECT booking_bcc FROM settings LIMIT 1`
    );

    const [paymentRows] = await connection.query(
      `SELECT payment_type FROM booking_payments
       WHERE booking_id = ? AND (isDelete IS NULL OR isDelete = 0)
       ORDER BY id DESC LIMIT 1`,
      [id]
    );
    const paymentType = paymentRows?.[0]?.payment_type;

    const isResend = resendMode > 0 || Boolean(overrideEmail);
    const adminBcc = resolveBookingBcc(settingsData[0]?.booking_bcc);

    let targetEmails = [];
    let disableBcc = false;
    if (overrideEmail) {
      targetEmails = [overrideEmail];
      disableBcc = true;
    } else if (resendMode === 1) {
      disableBcc = true;
    } else if (resendMode === 2) {
      targetEmails = [adminBcc];
      disableBcc = true;
    } else if (!attendeeEmail) {
      targetEmails = [adminBcc];
      disableBcc = true;
    }

    const logTypeResolved =
      options.logType ||
      (isResend
        ? 'Re-Sent Booking Confirmation'
        : !attendeeEmail && !overrideEmail
          ? 'Booking Confirmation (office copy)'
          : 'Booking Confirmation');

    const bookingRefSuffix =
      logTypeResolved === 'Re-Sent Booking Confirmation' && resendMode !== 13
        ? 'R'
        : '';

    await sendBookingConfirmation(
      {
        course_name: courseData[0]?.course_name || 'Course',
        booking_ref: booking.booking_ref,
        booking_type: resolveBookingConfirmationRefSuffix({
          typeOfBook: booking.type_of_book,
          paymentType,
        }),
        type_of_book: booking.type_of_book,
        payment_type: paymentType,
        bookingRefSuffix,
        refundable: Number(booking.refundable) || 0,
        attendees,
        ...(targetEmails.length ? { targetEmails } : {}),
        disableBcc,
        location: locationData[0] || {},
        event_dates: eventDates,
        booking: {
          total_amount: booking.total_amount,
          payment_due: Math.max(0, Number(booking.payment_due) || 0),
          vat: booking.vat,
          total_fees: booking.total_fees,
        },
        course_email_content: courseData[0]?.email_content || '',
        franchise: franchiseData[0] || {},
        bcc: adminBcc,
        ip: options.clientIp || '',
        logType: logTypeResolved,
        emailBy: options.emailBy || 't',
      },
      pool
    );

    console.log(
      `[ADMIN][BOOKING][EMAIL] Confirmation sent for booking ${id} (${booking.booking_ref})`
    );
    return { sent: true, booking_ref: booking.booking_ref };
  } catch (error) {
    console.error(
      `[ADMIN][BOOKING][EMAIL] Failed for booking ${id}:`,
      error.message || error
    );
    return { sent: false, reason: error.message || 'send_failed' };
  } finally {
    connection.release();
  }
}

async function sendAdminBookingRefundEmail(pool, bookingId, options = {}) {
  const id = Number(bookingId);
  if (!Number.isFinite(id) || id <= 0) return { sent: false, reason: 'invalid_id' };

  try {
    const result = await sendBookingRefundEmail(pool, id, options);
    if (result?.sent) {
      console.log(`[ADMIN][BOOKING][EMAIL] Refund sent for booking ${id}`);
    }
    return result;
  } catch (error) {
    console.error(
      `[ADMIN][BOOKING][EMAIL] Refund failed for booking ${id}:`,
      error.message || error
    );
    return { sent: false, reason: error.message || 'send_failed' };
  }
}

async function sendAdminBookingDeleteEmail(pool, bookingId, options = {}) {
  const id = Number(bookingId);
  if (!Number.isFinite(id) || id <= 0) return { sent: false, reason: 'invalid_id' };

  try {
    const result = await sendBookingDeleteEmail(pool, id, options);
    if (result?.sent) {
      console.log(`[ADMIN][BOOKING][EMAIL] Delete notification sent for booking ${id}`);
    }
    return result;
  } catch (error) {
    console.error(
      `[ADMIN][BOOKING][EMAIL] Delete email failed for booking ${id}:`,
      error.message || error
    );
    return { sent: false, reason: error.message || 'send_failed' };
  }
}

async function sendAdminBookingFeedbackEmail(pool, bookingId, options = {}) {
  const id = Number(bookingId);
  if (!Number.isFinite(id) || id <= 0) return { sent: false, reason: 'invalid_id' };

  try {
    const result = await sendBookingFeedbackEmail(pool, id, options);
    if (result?.sent) {
      console.log(`[ADMIN][BOOKING][EMAIL] Feedback sent for booking ${id}`);
    }
    return result;
  } catch (error) {
    console.error(
      `[ADMIN][BOOKING][EMAIL] Feedback failed for booking ${id}:`,
      error.message || error
    );
    return { sent: false, reason: error.message || 'send_failed' };
  }
}

/**
 * Send a confirmation email for each booking id (multi-attendee wizard / cart).
 */
async function sendAdminBookingConfirmationEmails(pool, bookingIds, options = {}) {
  const ids = [...new Set((bookingIds || []).map((id) => Number(id)).filter((n) => n > 0))];
  const results = [];
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    const result = await sendAdminBookingConfirmationEmail(pool, id, options);
    results.push({ booking_id: id, ...result });
  }
  return results;
}

module.exports = {
  sendAdminBookingConfirmationEmail,
  sendAdminBookingConfirmationEmails,
  sendAdminBookingRefundEmail,
  sendAdminBookingDeleteEmail,
  sendAdminBookingFeedbackEmail,
};
