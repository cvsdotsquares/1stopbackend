const nodemailer = require('nodemailer');
const { phpSerialize } = require('../../utils/phpSerialize');
const { getMailFrom, getMailFromAddress } = require('../../utils/mailFrom');
const { getSiteUrl } = require('../utils/siteUrl');
const { loadAdminSettings } = require('./settingsService');

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

function nowMysql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function currencyFormatted(amt) {
  const value = Number(amt);
  const safe = Number.isFinite(value) ? value : 0;
  return `&pound;${safe.toFixed(2)}`;
}

function formatDateDDMMYYYY(dateValue) {
  if (!dateValue) return '';
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

async function getBookingBcc(pool) {
  const settings = await loadAdminSettings(pool);
  return (
    String(settings.booking_bcc || process.env.BOOKING_BCC || '').trim() || undefined
  );
}

async function logEmail(pool, { to, bcc, subject, html, status, type, bookRef }) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO email_logs (\`to\`, cc, bcc, \`from\`, subject, email_content, status, type, book_ref, created)
       VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        to,
        bcc || '',
        getMailFromAddress(),
        subject,
        html,
        status,
        type,
        bookRef || '',
      ]
    );
  } catch (err) {
    console.error('[ADMIN][BOOKINGS][EMAIL_LOG]', err.message);
  }
}

async function sendMail(pool, { to, toName, subject, html, bcc, logType, bookRef }) {
  if (!isValidEmail(to)) {
    return false;
  }

  const mailOptions = {
    from: getMailFrom(),
    to: toName ? { name: toName, address: to } : to,
    subject,
    html,
    text: html.replace(/<[^>]+>/g, ' '),
  };

  if (bcc) {
    mailOptions.bcc = bcc;
  }

  let status = 0;
  try {
    await transporter.sendMail(mailOptions);
    status = 1;
  } catch (err) {
    console.error('[ADMIN][BOOKINGS][EMAIL]', err.message);
    status = 0;
  }

  await logEmail(pool, {
    to,
    bcc: bcc || '',
    subject,
    html,
    status,
    type: logType,
    bookRef,
  });

  return status === 1;
}

function buildRefundEmailHtml({ siteUrl, pupil, courseName, bData }) {
  const headerPath = bData.email_header
    ? `${siteUrl}/admin/uploads/${bData.email_header}`
    : `${siteUrl}/images/header-img.jpg`;
  const logoWebPath = bData.website || siteUrl;
  const logoPath = bData.email_logo
    ? `${siteUrl}/admin/uploads/${bData.email_logo}`
    : `${siteUrl}/images/logo.png`;
  const footerPath = bData.email_footer
    ? `${siteUrl}/admin/uploads/${bData.email_footer}`
    : `${siteUrl}/images/footer-img.jpg`;

  return `<!Doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" />
<title>1stopinstruction.com</title>
</head>
<body style="margin:0; padding:0;">
<div align="center">
  <table width="800" border="0" align="center" style="background: #f5f5f5 none repeat scroll 0 0; border: 1px solid #e0e0e0; padding: 5px;">
    <tbody>
      <tr>
        <td class="header">
          <img src="${headerPath}" width="784" height="177" alt=""/>
        </td>
      </tr>
      <tr>
        <td class="content">
          <table width="100%" border="0" style="background: #ffffff none repeat scroll 0 0; padding: 10px; margin:0;">
            <tbody><tr>
              <td style="font-size:9.0pt;font-family:Arial,sans-serif">
                Hello ${pupil},<br>
                <p>A refund has been made to your booking on ${courseName} Course with 1 Stop Instruction.<br> Your booking ${courseName} now stands Cancel.</p>
                <p>If you want another booking, please visit our site <a href="${siteUrl}/bookings"> Booking Here</a></p>
              </td>
            </tr></tbody>
          </table><br>
        </td>
      </tr>
      <tr>
        <td><table width="100%" border="0">
          <tbody>
            <tr>
              <td><p class="MsoNormal"><span><b><i><span style="font-size:13.5pt">1 Stop Instruction</span></i></b></span></p></td>
            </tr>
            <tr>
              <td align="left" valign="middle">
                <a href="${logoWebPath}"><img src="${logoPath}" width="90" alt=""/></a>
              </td>
            </tr>
          </tbody>
        </table></td>
      </tr>
      <tr>
        <td class="footer">
          <p align="center" style="text-align:center;background:#e6e6e8" class="MsoNormal"><span><b><i><span style="font-size:10.0pt;font-family:Arial,sans-serif">"Roadcraft professionals for all categories of driving"</span></i></b></span></p>
          <p style="font-family: Arial, sans-serif; text-align:center; font-size:9.5pt;">Please visit our website for <a href="${siteUrl}/contactus.php">directions</a> and our <a href="${siteUrl}/termsandconditions.php">terms &amp; conditions </a></p>
          <p style="margin-bottom:0;"><img src="${footerPath}" width="786" height="55" alt=""/></p>
        </td>
      </tr>
    </tbody>
  </table>
</div>
</body>
</html>`;
}

function buildDeleteEmailHtml({ siteUrl, content }) {
  const htmlContent = String(content || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>\n');

  return `<!Doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" />
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <title>1stopinstruction.com</title>
</head>
<body style="margin:0; padding:0;">
  <div align="center">
    <table width="800" border="0" align="center" style="background: #f5f5f5 none repeat scroll 0 0; border: 1px solid #e0e0e0; padding: 5px;">
      <tbody>
        <tr>
          <td class="header"><img src="${siteUrl}/images/header-img.jpg" width="784" height="177" alt=""/></td>
        </tr>
        <tr>
          <td class="content">
            <table width="100%" border="0" style="background: #ffffff none repeat scroll 0 0;padding: 10px; margin:0;">
              <tbody>
                <tr>
                  <td style="font-size:9.0pt;font-family:Arial,sans-serif">
                    <p>${htmlContent}</p>
                  </td>
                </tr>
                <tr>
                  <td>
                    <table width="100%" border="0">
                      <tbody>
                        <tr>
                          <td><p class="MsoNormal" style="margin: 10px 0px; font-family: arial;"><span><b><i><span style="font-size:13.5pt">1 Stop Instruction</span></i></b></span></p></td>
                        </tr>
                        <tr>
                          <td align="left" valign="middle">
                            <a href="${siteUrl}"><img src="${siteUrl}/images/logo.png" width="90" alt=""/></a>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
        <tr>
          <td class="footer">
            <p align="center" style="text-align:center;background:#e6e6e8" class="MsoNormal"><span><b><i><span style="font-size:10.0pt;font-family:Arial,sans-serif">"Roadcraft professionals for all categories of driving"</span></i></b></span></p>
            <p style="font-family: Arial, sans-serif; text-align:center; font-size:9.5pt;">Please visit our website for <a href="${siteUrl}/contactus.php">directions</a> and our <a href="${siteUrl}/termsandconditions.php">terms &amp; conditions </a></p>
            <p style="margin-bottom:0;"><img src="${siteUrl}/images/footer-img.jpg" width="786" height="55" alt=""/></p>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</body>
</html>`;
}

async function getBookingById(pool, bookingId) {
  const [rows] = await pool.query('SELECT * FROM bookings WHERE id = ? LIMIT 1', [
    bookingId,
  ]);
  return rows[0] || null;
}

async function sendRefundMail(pool, bookingId, req) {
  const [rows] = await pool.query(
    `SELECT booking_attendees.booking_ref, courses.*, booking_attendees.first_name,
            booking_attendees.sur_name, booking_attendees.email, bookings.id AS bid
     FROM bookings
     JOIN courses ON courses.id = bookings.course_id
     JOIN booking_attendees ON booking_attendees.booking_id = bookings.id
     WHERE bookings.id = ?`,
    [bookingId]
  );

  const bData = rows[0];
  if (!bData || !isValidEmail(bData.email)) {
    return;
  }

  const pupil = `${bData.first_name} ${bData.first_name}`;
  const siteUrl =
    getSiteUrl(req) ||
    String(process.env.PHP_SITE_URL || process.env.SITE_URL || '').replace(/\/$/, '');
  const html = buildRefundEmailHtml({
    siteUrl,
    pupil,
    courseName: bData.course_name,
    bData,
  });
  const bcc = await getBookingBcc(pool);

  await sendMail(pool, {
    to: bData.email,
    toName: pupil,
    subject: '1Stop Instruction Booking Refund',
    html,
    bcc,
    logType: 'Booking Refund',
    bookRef: bData.booking_ref,
  });
}

async function sendMailAfterDeleteBooking(pool, bookingId, email, subject, content, req) {
  const [rows] = await pool.query(
    'SELECT first_name, sur_name, booking_ref FROM booking_attendees WHERE booking_id = ? LIMIT 1',
    [bookingId]
  );
  const bData = rows[0];
  if (!bData || !isValidEmail(email)) {
    return false;
  }

  const pupil = `${bData.first_name} ${bData.sur_name}`;
  const siteUrl =
    getSiteUrl(req) ||
    String(process.env.PHP_SITE_URL || process.env.SITE_URL || '').replace(/\/$/, '');
  const html = buildDeleteEmailHtml({ siteUrl, content });
  const bcc = await getBookingBcc(pool);

  return sendMail(pool, {
    to: email,
    toName: pupil,
    subject,
    html,
    bcc,
    logType: `Delete Booking - ${bData.booking_ref}`,
    bookRef: bData.booking_ref,
  });
}

async function decrementEventLocks(pool, booking) {
  const courseEventId = booking.course_event_id;

  const [frozenRows] = await pool.query(
    'SELECT * FROM freeze WHERE course_event_id = ? LIMIT 1',
    [courseEventId]
  );
  const frozenData = frozenRows[0] || null;

  const [ptnRows] = await pool.query(
    `SELECT parent, booking_limit, bookings_done, manual_lock_done, automatic_lock_done
     FROM course_events WHERE id = ? LIMIT 1`,
    [courseEventId]
  );
  const ptn = ptnRows[0];
  if (!ptn) {
    return;
  }

  const sBookingDone = frozenData ? frozenData.bookings_done : ptn.bookings_done;
  const sManualLockDone = frozenData ? frozenData.manual_lock_done : ptn.manual_lock_done;
  const sAutomaticLockDone = frozenData
    ? frozenData.automatic_lock_done
    : ptn.automatic_lock_done;

  const [attendeeRows] = await pool.query(
    'SELECT vehicle_type FROM booking_attendees WHERE booking_id = ? LIMIT 1',
    [booking.id]
  );
  const attendee = attendeeRows[0];
  if (!attendee) {
    return;
  }

  const clauses = [];
  const values = [];
  const vt = Number(attendee.vehicle_type);

  if (vt === 0) {
    const updateManual = sManualLockDone - 1;
    if (updateManual > 0) {
      clauses.push('manual_lock_done = ?');
      values.push(updateManual);
    } else {
      clauses.push('manual_lock_done = 0');
    }
  } else if (vt === 1) {
    const updateAutomatic = sAutomaticLockDone - 1;
    if (updateAutomatic > 0) {
      clauses.push('automatic_lock_done = ?');
      values.push(updateAutomatic);
    } else {
      clauses.push('automatic_lock_done = 0');
    }
  }

  const nowBookingDone = sBookingDone - 1;
  if (nowBookingDone > 0) {
    clauses.push('bookings_done = ?');
    values.push(nowBookingDone);
  } else {
    clauses.push('bookings_done = 0');
  }

  const tableName = frozenData ? 'freeze' : 'course_events';
  const whereClause = frozenData ? 'course_event_id = ?' : 'parent = ?';
  const whereValue = frozenData ? courseEventId : ptn.parent;

  await pool.query(
    `UPDATE ${tableName} SET ${clauses.join(', ')} WHERE ${whereClause}`,
    [...values, whereValue]
  );
}

async function buildCourseInfo(pool, booking) {
  const courseInfo = {};

  const [courseRows] = await pool.query(
    'SELECT course_abb FROM courses WHERE id = ? LIMIT 1',
    [booking.course_id]
  );
  if (courseRows[0]) {
    courseInfo.course_abb = courseRows[0].course_abb;
  }

  const [eventRows] = await pool.query(
    'SELECT location_id FROM course_events WHERE id = ? LIMIT 1',
    [booking.course_event_id]
  );
  if (eventRows[0]) {
    const [locationRows] = await pool.query(
      'SELECT location_name FROM locations WHERE id = ? LIMIT 1',
      [eventRows[0].location_id]
    );
    if (locationRows[0]) {
      courseInfo.location = locationRows[0].location_name;
    }
  }

  const [dateRows] = await pool.query(
    'SELECT event_date FROM course_event_dates WHERE course_event_id = ? LIMIT 1',
    [booking.course_event_id]
  );
  if (dateRows[0]) {
    courseInfo.event_date = dateRows[0].event_date;
  }

  return courseInfo;
}

async function refundBooking(pool, bookingId, req) {
  const booking = await getBookingById(pool, bookingId);
  if (!booking) {
    return { ok: false, message: 'Booking not found to refund' };
  }

  const [result] = await pool.query(
    'UPDATE bookings SET refundable = 2, status = 2 WHERE id = ?',
    [bookingId]
  );

  if (!result || result.affectedRows === 0) {
    return { ok: false, message: 'Error in refund for bookings' };
  }

  await sendRefundMail(pool, bookingId, req);

  return {
    ok: true,
    message: 'Refunded successfully',
    courseEventId: booking.course_event_id,
  };
}

async function deleteBooking(pool, bookingId, body, adminId, req) {
  const booking = await getBookingById(pool, bookingId);
  if (!booking) {
    return { ok: false, message: 'Booking not found to delete' };
  }

  const [attendeeRows] = await pool.query(
    'SELECT * FROM booking_attendees WHERE booking_id = ? LIMIT 1',
    [bookingId]
  );
  const attendee = attendeeRows[0];
  if (!attendee) {
    return { ok: false, message: 'Error in deleting bookings' };
  }

  attendee.full_name = `${String(attendee.first_name || '').trim()} ${String(attendee.sur_name || '').trim()}`.trim();

  const courseInfo = await buildCourseInfo(pool, booking);

  if (Number(booking.status) === 1) {
    await decrementEventLocks(pool, booking);
  }

  const deleteType = body?.delete_type || body?.deleteType || '';
  const shouldSendMail =
    deleteType === 'send_mail_delete' &&
    body?.before_del_email &&
    body?.before_del_subject &&
    body?.before_del_message;

  if (shouldSendMail) {
    await sendMailAfterDeleteBooking(
      pool,
      bookingId,
      body.before_del_email,
      body.before_del_subject,
      body.before_del_message,
      req
    );
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [deleteResult] = await connection.query(
      'DELETE FROM bookings WHERE id = ?',
      [bookingId]
    );

    if (!deleteResult || deleteResult.affectedRows === 0) {
      await connection.rollback();
      return { ok: false, message: 'Error in deleting bookings' };
    }

    await connection.query('DELETE FROM booking_attendees WHERE booking_id = ?', [
      bookingId,
    ]);
    await connection.query(
      'UPDATE booking_payments SET isDelete = 1 WHERE booking_id = ?',
      [bookingId]
    );

    const timestamp = nowMysql();
    await connection.query(
      `INSERT INTO booking_update_history
       (booking_id, updated_by_admin_id, type, status, created, modified)
       VALUES (?, ?, 'deleted', 'Booking deleted', ?, ?)`,
      [bookingId, adminId, timestamp, timestamp]
    );

    const bookingData = phpSerialize({
      booking,
      attendee,
      course_info: courseInfo,
    });

    await connection.query(
      `INSERT INTO deleted_bookings (booking_id, booking_ref, booking_data)
       VALUES (?, ?, ?)`,
      [booking.id, attendee.booking_ref, bookingData]
    );

    await connection.commit();

    return {
      ok: true,
      message: 'Booking deleted successfully and increases space availablity',
      courseEventId: booking.course_event_id,
    };
  } catch (err) {
    await connection.rollback();
    console.error('[ADMIN][BOOKINGS][DELETE]', err.message);
    return { ok: false, message: 'Error in deleting bookings' };
  } finally {
    connection.release();
  }
}

async function getDeleteMailTemplate(pool, bookingId) {
  const [rows] = await pool.query(
    `SELECT booking_attendees.id, booking_attendees.booking_id, booking_attendees.booking_ref,
            booking_attendees.first_name, booking_attendees.sur_name, booking_attendees.email,
            bookings.id AS bid, bookings.total_fees, bookings.total_amount, bookings.payment_due,
            bookings.course_id, bookings.course_event_id, bookings.type_of_book,
            courses.course_abb, courses.cancel_price, course_event_dates.event_date
     FROM bookings
     LEFT JOIN booking_attendees ON bookings.id = booking_attendees.booking_id
     LEFT JOIN courses ON bookings.course_id = courses.id
     LEFT JOIN course_events ON bookings.course_event_id = course_events.id
     LEFT JOIN course_event_dates ON bookings.course_event_id = course_event_dates.course_event_id
     WHERE bookings.id = ?`,
    [bookingId]
  );

  if (!rows || rows.length === 0) {
    return { ok: false };
  }

  const row = rows[0];
  const fullName = `${row.first_name} ${row.sur_name}`;
  const courseName = row.course_abb;
  const courseDate = formatDateDDMMYYYY(row.event_date);
  const bookingRef = row.booking_ref;
  const receivedAmount = Number(row.total_amount) - Number(row.payment_due);
  const adminFee = Number(row.cancel_price);
  const refundAmount = currencyFormatted(receivedAmount - adminFee);
  const bookingRefContent = `${bookingRef} - ${String(row.type_of_book || '')
    .charAt(0)
    .toUpperCase()}${String(row.type_of_book || '').slice(1)}`;

  const mailTemplate = `Dear ${fullName},\n\nFollowing your recent request, your ${courseName} booked for ${courseDate} (Ref: ${bookingRefContent}) has now been cancelled.\n\nWe have also processed your refund of ${refundAmount}\n\nPlease allow 7-10 working days for any refunded amount to be received in your account, although the process usually happens a lot quicker.\n\nIf you have any further questions in the meantime, please feel free to contact us.\n\nRegards,`;

  return {
    ok: true,
    data: {
      booking_id: row.booking_id,
      email: row.email,
      subject: `Booking Cancelled - Ref: ${bookingRef}`,
      mail_template: mailTemplate,
    },
  };
}

module.exports = {
  refundBooking,
  deleteBooking,
  getDeleteMailTemplate,
};
