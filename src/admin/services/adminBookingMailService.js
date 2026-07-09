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

function normalizeSiteUrl(url) {
  return String(url || '')
    .replace(/http:\/\/https:\/\//g, 'https://')
    .replace(/^http:\/\//g, 'https://')
    .replace(/https:\/\/www\.pepmo\.co\.uk/g, 'http://www.pepmo.co.uk');
}

async function saveEmailLog(pool, payload) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO email_logs (\`to\`, cc, bcc, \`from\`, subject, email_content, status, type, book_ref, created)
     VALUES (?, '', '', ?, ?, ?, ?, 'Feedback', ?, NOW())`,
    [
      payload.to,
      payload.from,
      payload.subject,
      payload.body,
      payload.status,
      payload.bookingRef,
    ]
  );
}

async function sendFeedbackMail(pool, bookId) {
  const bookingId = Number(bookId);
  if (!Number.isFinite(bookingId) || bookingId <= 0) {
    return false;
  }

  const [rows] = await pool.query(
    `SELECT booking_attendees.booking_ref, settings.site_contact, settings.site_email,
      courses.course_name, courses.send_feedback_mail, courses.feedback_content, courses.email_header,
      booking_attendees.first_name, booking_attendees.sur_name, booking_attendees.email,
      bookings.id AS bid
     FROM bookings
     JOIN booking_attendees ON booking_attendees.booking_id = bookings.id
     JOIN courses ON courses.id = bookings.course_id
     JOIN settings ON settings.id = 1
     WHERE bookings.id = ?
     LIMIT 1`,
    [bookingId]
  );
  const bData = rows[0];
  if (!bData || Number(bData.send_feedback_mail) !== 1) {
    return false;
  }

  const email = trim(bData.email);
  if (!isValidEmail(email)) {
    return false;
  }

  const pupil = `${trim(bData.first_name)} ${trim(bData.sur_name)}`.trim();
  const siteUrl = normalizeSiteUrl(process.env.PHP_SITE_URL || 'https://www.1stopinstruction.com');
  const adminUrl = normalizeSiteUrl(
    process.env.ADMIN_SITE_URL || process.env.PHP_ADMIN_URL || siteUrl
  );
  const headerPath = bData.email_header
    ? `${adminUrl}/admin/uploads/${bData.email_header}`
    : `${siteUrl}/images/header-img.jpg`;
  const logoPath = `${siteUrl}/images/logo.png`;
  const feedbackContent = normalizeSiteUrl(bData.feedback_content || '');
  const subject = `You have completed your ${bData.course_name} Course`;
  const body = `<!Doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1" /><title>1stopinstruction.com</title></head>
<body style="margin:0;padding:0;">
<div align="center">
<table width="800" border="0" align="center" style="background:#f5f5f5;border:1px solid #e0e0e0;padding:5px;">
<tr><td><img src="${headerPath}" width="784" height="177" alt="" /></td></tr>
<tr><td style="background:#fff;padding:10px;font-family:Arial,sans-serif;font-size:9pt;">
Dear ${trim(bData.first_name)},<p></p>${feedbackContent}<p></p>
Kind Regards,<br /><strong><i>1 Stop Instruction</i></strong>
</td></tr>
<tr><td style="text-align:center;background:#e6e6e8;padding:10px;">
<img src="${logoPath}" width="90" alt="" />
</td></tr>
</table>
</div>
</body></html>`;

  const nodemailer = require('nodemailer');
  const { getMailFrom, getMailFromAddress } = require('../../utils/mailFrom');
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

  let status = 0;
  try {
    await transporter.sendMail({
      from: getMailFrom(),
      to: email,
      subject,
      html: body,
    });
    status = 1;
  } catch (err) {
    console.error('[ADMIN][FEEDBACK-MAIL]', err.message);
  }

  await saveEmailLog(pool, {
    to: email,
    from: getMailFromAddress(),
    subject,
    body,
    status,
    bookingRef: trim(bData.booking_ref),
  });

  return status === 1;
}

module.exports = {
  sendAdminBookingMail,
  sendFeedbackMail,
};
