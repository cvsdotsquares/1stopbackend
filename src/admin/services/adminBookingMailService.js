const { sendBookingConfirmation } = require('../../utils/emailService');
const { loadAdminSettings } = require('./settingsService');

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function isValidEmail(email) {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}

async function loadBookingMailData(pool, bookingId) {
  const [rows] = await pool.query(
    `SELECT bookings.*, booking_attendees.*, courses.course_name, courses.course_email_content,
      course_events.*, locations.*, franchise.*
     FROM bookings
     JOIN booking_attendees ON booking_attendees.booking_id = bookings.id
     JOIN courses ON courses.id = bookings.course_id
     JOIN course_events ON course_events.id = bookings.course_event_id
     JOIN locations ON locations.id = course_events.location_id
     JOIN franchise ON franchise.id = course_events.franchise_id
     WHERE bookings.id = ?
     LIMIT 1`,
    [Number(bookingId)]
  );
  return rows[0] || null;
}

async function getBookingBcc(pool) {
  const settings = await loadAdminSettings(pool);
  return trim(settings.booking_bcc || process.env.BOOKING_BCC || '') || undefined;
}

/**
 * Port of Booking::sendBookingMail() resend options from edit_booking.php.
 * resendConf: 1 = customer, 2 = admin BCC only, 3 = both, or custom email string.
 */
async function sendAdminBookingMail(pool, bookingId, resendConf, req) {
  const bData = await loadBookingMailData(pool, bookingId);
  if (!bData || !trim(bData.email)) {
    return false;
  }

  const [dateRows] = await pool.query(
    `SELECT event_date, event_start_time, event_end_time
     FROM course_event_dates
     WHERE course_event_id = ?
     ORDER BY event_date ASC`,
    [bData.course_event_id]
  );

  const attendee = {
    first_name: bData.first_name,
    sur_name: bData.sur_name,
    email: bData.email,
    vehicle_type: bData.vehicle_type,
    contact1: bData.contact1,
    contact2: bData.contact2,
    contact3: bData.contact3,
    license_number: bData.license_number,
    theory_number: bData.theory_number,
    booking_ref: bData.booking_ref,
  };

  const bookingBcc = await getBookingBcc(pool);
  const resend = resendConf != null && resendConf !== '' ? resendConf : null;
  let targetEmails = [];
  let disableBcc = false;
  let logType = 'Booking Confirmation';

  if (resend === 1 || resend === '1') {
    targetEmails = [bData.email];
    disableBcc = true;
    logType = 'Re-Sent Booking Confirmation';
  } else if (resend === 2 || resend === '2') {
    if (!bookingBcc) {
      return false;
    }
    targetEmails = [bookingBcc];
    disableBcc = true;
    logType = 'Re-Sent Booking Confirmation';
  } else if (resend === 3 || resend === '3') {
    targetEmails = [bData.email];
    logType = 'Re-Sent Booking Confirmation';
  } else if (isValidEmail(resend)) {
    targetEmails = [String(resend).trim()];
    logType = 'Re-Sent Booking Confirmation';
  } else {
    targetEmails = [bData.email];
  }

  const bookingType = String(bData.type_of_book || 'o');
  const suffix =
    resend != null && resend !== '' && resend !== 13 && resend !== '13'
      ? bookingType === 'r'
        ? '2R'
        : 'R'
      : '';

  try {
    await sendBookingConfirmation(
      {
        course_name: bData.course_name,
        booking_ref: bData.booking_ref,
        booking_type: bookingType,
        bookingRefSuffix: suffix,
        refundable: bData.refundable,
        attendees: [attendee],
        targetEmails,
        disableBcc,
        location: {
          location_name: bData.location_name,
          address1: bData.address1,
          address2: bData.address2,
          address3: bData.address3,
          address4: bData.address4,
          postcode: bData.postcode,
          direction_content: bData.direction_content,
          direction_map: bData.direction_map,
        },
        event_dates: dateRows,
        booking: {
          total_amount: bData.total_amount,
          payment_due: bData.payment_due,
          id: bData.id,
        },
        course_email_content: bData.course_email_content || '',
        franchise: {
          franchise_name: bData.franchise_name,
          telephone: bData.telephone,
          freephone: bData.freephone,
          franchise_email: bData.franchise_email,
          website: bData.website,
          email_header: bData.email_header,
          email_footer: bData.email_footer,
          email_logo: bData.email_logo,
        },
        bcc: bookingBcc,
        ip: req?.ip || '',
        logType,
        emailBy: 0,
      },
      pool
    );
    return true;
  } catch (err) {
    console.error('[ADMIN][BOOKINGS][SEND_MAIL]', err.message);
    return false;
  }
}

module.exports = {
  sendAdminBookingMail,
};
