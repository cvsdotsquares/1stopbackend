const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { replaceTokens } = require('../utils/tokenReplacer');
const { getMailFrom, getMailFromAddress, getReplyTo } = require('../utils/mailFrom');

const isDeadlockError = (err) =>
  !!err && (err.errno === 1213 || err.code === 'ER_LOCK_DEADLOCK' || err.sqlState === '40001');

let __cbRunSeq = 0;

const {
  buildSubject,
  buildBookingConfirmationHtml,
  buildBookingConfirmationText
} = require('../utils/bookingConfirmTemplates');

const LOG_FILE = path.join(__dirname, '../../confirm_booking.log');
const ALREADY_CONFIRMED_LOG = path.join(__dirname, '../../confirm_already_confirm.log');
const AFTER_SAVE_ATTENDEE_LOG = path.join(__dirname, '../../aftersaveattendee.txt');
const ADD_BOOKINGS_DONE_LOG = path.join(__dirname, '../../addBookingsdone.txt');

const logRequest = (status, message, data = null, logFile = LOG_FILE) => {
  const timestamp = new Date().toLocaleString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).replace(',', '');
  const logEntry = `[${timestamp}] :: Status:${status} -- ${message} >> ${data ? JSON.stringify(data) : 'N/A'}\n`;
  fs.appendFileSync(logFile, logEntry);

  // Mirror key request logs to PM2 stdout/stderr for easier live debugging
  const consoleMessage = `[confirmBooking] Status:${status} -- ${message}`;
  if (status >= 400) {
    console.error(consoleMessage, data || 'N/A');
  } else {
    console.log(consoleMessage, data || 'N/A');
  }
};

const validateRequest = (body) => {
  const errors = {};

  if (!body.school_course_id) errors.school_course_id = ['School course id is required field'];
  else if (!Number.isInteger(Number(body.school_course_id))) errors.school_course_id = ['School course id must be an integer'];

  if (!body.location) errors.location = ['Location is required field'];
  if (!body.course_type) errors.course_type = ['Course type is required field'];

  if (!body.date) errors.date = ['Date is required field'];
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) errors.date = ['Date has wrong format. Use one of these formats instead: YYYY-MM-DD.'];

  if (!body.start_time) errors.start_time = ['Start time is required field'];
  else if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(body.start_time)) errors.start_time = ['Time has wrong format. Use one of these formats instead: hh:mm.'];

  if (!body.finish_time) errors.finish_time = ['Finish time is required field'];
  else if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(body.finish_time)) errors.finish_time = ['Time has wrong format. Use one of these formats instead: hh:mm.'];

  if (!body.bike_hire && !body.bike_hire_type) errors.bike_hire = ['Bike hire is required field'];
  if (!body.course_event_id) errors.course_event_id = ['This field may not be blank.'];
  if (!body.space_hold_id) errors.space_hold_id = ['This field may not be blank.'];
  if (!body.rideto_order_number) errors.rideto_order_number = ['This field may not be blank.'];
  if (!body.first_name) errors.first_name = ['This field may not be blank.'];
  if (!body.phone) errors.phone = ['This field may not be blank.'];

  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) errors.email = ['Enter a valid email address.'];

  return Object.keys(errors).length > 0 ? errors : null;
};

const removeCurLock = async (pool, space_hold_id) => {
  try {
    const [lockData] = await pool.query('SELECT event_id FROM lock_bookings WHERE id = ?', [space_hold_id]);
    if (lockData.length > 0) {
      const eventId = lockData[0].event_id;
      await pool.query('DELETE FROM lock_bookings WHERE id = ?', [space_hold_id]);

      const [eventData] = await pool.query('SELECT parent FROM course_events WHERE id = ?', [eventId]);
      if (eventData.length > 0) {
        await pool.query('UPDATE course_events SET current_locks = GREATEST(0, current_locks - 1) WHERE parent = ? AND current_locks > 0', [eventData[0].parent]);
      }
    }
  } catch (error) {
    console.error('Error removing lock:', error);
  }
};

/** Converts dd/mm/yyyy → yyyy-mm-dd for MySQL DATE columns. Returns null if not parseable. */
const parseDobToMysql = (dob) => {
  if (!dob) return null;
  const match = String(dob).trim().match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
};

const parseBooleanEnv = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const normalizeUrl = (value, fallback = '') => {
  const url = String(value || '').trim();
  if (!url) return fallback;
  if (/^https?:\/\//i.test(url)) return url.replace(/^http:\/\//i, 'https://');
  return `https://${url}`;
};

const mapBikeHireToVehicleType = (bikeHire) => {
  const normalizedBikeHire = String(bikeHire || '').trim().toLowerCase();
  const compactBikeHire = normalizedBikeHire.replace(/[^a-z0-9]+/g, '_');

  if (normalizedBikeHire === '1' || compactBikeHire === '1') return 1;
  if (normalizedBikeHire === '3' || compactBikeHire === '3') return 3;

  // Known explicit values
  if (
    normalizedBikeHire === 'automatic'
    || normalizedBikeHire === 'auto'
    || compactBikeHire === 'bike_type_auto'
    || compactBikeHire === 'bike_type_automatic'
  ) {
    return 1;
  }

  if (
    normalizedBikeHire === 'own'
    || normalizedBikeHire === 'own_vehicle'
    || normalizedBikeHire === 'own vehicle'
    || compactBikeHire === 'bike_type_own'
    || compactBikeHire === 'bike_type_own_vehicle'
  ) {
    return 3;
  }

  // Defensive keyword fallbacks for third-party enum variants
  if (compactBikeHire.includes('auto')) return 1;
  if (compactBikeHire.includes('own')) return 3;
  if (compactBikeHire.includes('manual')) return 0;

  return 0;
};

const getVehicleTypeLabel = (vehicleType) => {
  if (vehicleType === 1) return 'Automatic';
  if (vehicleType === 3) return 'I will be using my own vehicle';
  return 'Manual';
};

const buildBookingEmailData = async (connection, {
  bookingId,
  booking_ref,
  first_name,
  last_name,
  rideto_order_number,
  bike_hire,
  course_type,
  location,
  courseId,
  course_event_id
}) => {
  const [bookingTotals] = await connection.query('SELECT total_amount, payment_due, type_of_book FROM bookings WHERE id = ? LIMIT 1', [bookingId]);
  const [courseData] = await connection.query('SELECT course_name, email_content FROM courses WHERE id = ? LIMIT 1', [courseId]);
  const [locationData] = await connection.query(`
    SELECT l.location_name, l.address1, l.address2, l.address3, l.address4,
           l.postcode, l.direction_map, l.direction_content
    FROM locations l
    JOIN course_events ce ON ce.location_id = l.id
    WHERE ce.id = ?
    LIMIT 1
  `, [course_event_id]);
  const [eventDates] = await connection.query(`
    SELECT event_date, event_start_time
    FROM course_event_dates
    WHERE course_event_id = ?
    ORDER BY event_date ASC, event_start_time ASC
  `, [course_event_id]);
  const [franchiseData] = await connection.query(`
    SELECT f.email_header, f.email_footer, f.email_logo, f.website,
           f.telephone, f.freephone, f.franchise_email
    FROM franchise f
    JOIN course_events ce ON ce.franchise_id = f.id
    WHERE ce.id = ?
    LIMIT 1
  `, [course_event_id]);
  const [rideToRefRows] = await connection.query(`
    SELECT COALESCE(bad.rideto_orderid, ba.rideto_orderid) AS rideto_orderid
    FROM booking_attendees ba
    LEFT JOIN booking_attendees_dropdown bad ON bad.id = ba.contact_card_id
    WHERE ba.booking_id = ?
    ORDER BY ba.\`primary\` DESC, ba.id ASC
    LIMIT 1
  `, [bookingId]);

  const booking = bookingTotals[0] || {};
  const course = courseData[0] || {};
  const locationInfo = locationData[0] || {};
  const franchise = franchiseData[0] || {};
  const vehicleType = mapBikeHireToVehicleType(bike_hire);
  const rideToOrderId = String(rideToRefRows[0]?.rideto_orderid || rideto_order_number || '').trim();

  const siteUrl = normalizeUrl(process.env.PHP_SITE_URL || process.env.SITE_URL, 'https://1stopinstruction.com').replace(/\/$/, '');
  const directionMapImage = locationInfo.direction_map
    ? `${siteUrl}/maps/${locationInfo.direction_map}`
    : `${siteUrl}/images/no-map.jpg`;
  const defaultHeader = franchise.email_header
    ? `${siteUrl}/admin/uploads/${franchise.email_header}`
    : `${siteUrl}/images/header-img.jpg`;
  const defaultFooter = franchise.email_footer
    ? `${siteUrl}/admin/uploads/${franchise.email_footer}`
    : `${siteUrl}/images/footer-img.jpg`;
  const defaultLogo = franchise.email_logo
    ? `${siteUrl}/admin/uploads/${franchise.email_logo}`
    : `${siteUrl}/images/logo.png`;
  const defaultNoMap = `${siteUrl}/images/no_map.jpg`;

  return {
    booking_ref,
    booking_type: String(booking.type_of_book || '').trim().toLowerCase() === 'r'
      ? 'R2'
      : String(booking.type_of_book || 'R2').toUpperCase(),
    first_name,
    sur_name: last_name || '',
    rideto_ref: rideToOrderId ? `rt#${rideToOrderId}` : '',
    course_name: course.course_name || course_type || 'Course',
    vehicle_type_label: getVehicleTypeLabel(vehicleType),
    total_amount: Number(booking.total_amount || 0),
    payment_due: Math.max(0, Number(booking.payment_due || 0)),
    location_name: locationInfo.location_name || location || '',
    address1: locationInfo.address1 || '',
    address2: locationInfo.address2 || '',
    address3: locationInfo.address3 || '',
    address4: locationInfo.address4 || '',
    postcode: locationInfo.postcode || '',
    email_content_html: await replaceTokens(connection, course.email_content || ''),
    direction_content_html: await replaceTokens(connection, locationInfo.direction_content || ''),
    direction_map_url: normalizeUrl(directionMapImage),
    no_map_url: process.env.BOOKING_NO_MAP_URL || defaultNoMap,
    email_header_url: defaultHeader,
    email_footer_url: defaultFooter,
    email_logo_url: defaultLogo,
    website_url: normalizeUrl(franchise.website, siteUrl),
    telephone: franchise.telephone || '',
    freephone: franchise.freephone || '',
    franchise_email: franchise.franchise_email || process.env.CONTACT_FROM || process.env.SMTP_USER || '',
    site_url: siteUrl,
    contactus_url: `${siteUrl}/contactus`,
    terms_url: `${siteUrl}/terms-and-conditions`,
    eventDates
  };
};

const sendBookingEmail = async (bookingData, pool, meta = {}) => {
  const { booking_ref = '', ip = '', attendeeEmail = '' } = meta;

  const smtpSecure = parseBooleanEnv(process.env.SMTP_SECURE, false);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: smtpSecure,
    // Force STARTTLS upgrade on non-SMTPS ports unless explicitly disabled.
    requireTLS: !smtpSecure && parseBooleanEnv(process.env.SMTP_REQUIRE_TLS, true),
    auth: process.env.SMTP_USER && process.env.SMTP_PASS
      ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
      : undefined
  });

  // From header includes display name (e.g. `"1 Stop Instruction" <info@…>`);
  // fromAddress is the bare email used for logging + the validation guard below.
  const fromHeader = getMailFrom();
  const fromAddress = getMailFromAddress();
  const toAddress = (process.env.CONTACT_TO || '').trim();
  const bccVal = process.env.BOOKING_BCC || '';

  let subject = 'RestAPI booking confirmation';
  let html = '';
  let text = '';
  const errors = [];
  let htmlBuildOk = false;

  try {
    subject = buildSubject(bookingData);
  } catch (e) {
    errors.push(`buildSubject: ${e.message}`);
  }

  try {
    html = buildBookingConfirmationHtml(bookingData);
    htmlBuildOk = true;
  } catch (e) {
    errors.push(`buildBookingConfirmationHtml: ${e.message}`);
    html = `<!-- email HTML could not be built: ${String(e.message).replace(/-->/g, '')} -->`;
  }

  try {
    text = buildBookingConfirmationText(bookingData);
  } catch (e) {
    errors.push(`buildBookingConfirmationText: ${e.message}`);
    text = '';
  }

  if (attendeeEmail) {
    html += `\n\n<!-- attendee_email: ${String(attendeeEmail).replace(/-->/g, '')} -->`;
  }

  const mailOptions = {
    from: fromHeader || fromAddress,
    ...(getReplyTo() ? { replyTo: getReplyTo() } : {}),
    //to: toAddress,
    bcc: bccVal || undefined,
    subject,
    html,
    text: text || undefined
  };

  let emailStatus = 0;

  if (!fromAddress || !toAddress) {
    console.error('Booking email config missing: MAIL_FROM_EMAIL / CONTACT_FROM and CONTACT_TO');
    errors.push('Send skipped: MAIL_FROM_EMAIL/CONTACT_FROM and/or CONTACT_TO not set in environment');
  } else if (!htmlBuildOk) {
    errors.push('Send skipped: HTML body could not be built');
  } else {
    try {
      await transporter.sendMail(mailOptions);
      emailStatus = 1;
    } catch (error) {
      console.error('Email error:', error);
      errors.push(`sendMail: ${error?.message || String(error)}`);
      emailStatus = 0;
    }
  }

  if (errors.length) {
    html += `\n\n<!-- restapi_booking_email_errors: ${JSON.stringify(errors).replace(/-->/g, '')} -->`;
  }

  // Always record email_logs when pool is available — success, SMTP failure, or pre-send error (e.g. missing config / template error)
  if (pool) {
    try {
      const logTo = toAddress || '(not configured)';
      const logFrom = fromAddress || mailOptions.from || '(not configured)';
      await pool.query(`
        INSERT INTO email_logs (\`to\`, cc, bcc, \`from\`, subject, email_content, status, type, book_ref, ip, created)
        VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `, [
        logTo,
        bccVal,
        logFrom,
        subject,
        html,
        emailStatus,
        'R2 Booking Confirmation',
        booking_ref,
        ip || ''
      ]);
    } catch (logError) {
      console.error('Error logging RestAPI confirm booking email:', logError);
    }
  }

  return emailStatus === 1;
};

const confirmBooking = (pool) => async (req, res) => {
  if (req.method !== 'POST') {
    logRequest(405, 'Method not allowed', { method: req.method });
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const validationErrors = validateRequest(req.body);
  if (validationErrors) {
    logRequest(400, 'Validation failed', validationErrors);
    return res.status(400).json(validationErrors);
  }

  const {
    school_course_id,
    course_event_id,
    space_hold_id,
    rideto_order_number,
    first_name,
    last_name,
    phone,
    email,
    driving_licence,
    date_of_birth,
    bike_hire,
    bike_hire_type,
    course_type,
    location
  } = req.body;

  const resolvedBikeHire = bike_hire || bike_hire_type || '';
  const cbRunId = `cb_${Date.now()}_${++__cbRunSeq}`;

  // Performs the full booking transaction once. Returns a sentinel result
  // so the caller can decide what HTTP response to send. Throws on database
  // errors so the outer retry loop can decide whether to retry.
  const runTransaction = async () => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Step 1: Validate Space Lock
      const [lockCheck] = await connection.query('SELECT id FROM lock_bookings WHERE event_id = ? AND id = ?', [course_event_id, space_hold_id]);
      if (lockCheck.length === 0) {
        await connection.rollback();
        return { kind: 'lock_missing' };
      }

      // Step 2: Check Duplicate Order
      const [dupCheck1] = await connection.query('SELECT id FROM booking_attendees WHERE rideto_orderid = ?', [rideto_order_number]);
      const [dupCheck2] = await connection.query('SELECT id FROM booking_attendees_dropdown WHERE rideto_orderid = ?', [rideto_order_number]);

      if (dupCheck1.length > 0 || dupCheck2.length > 0) {
        await removeCurLock(connection, space_hold_id);
        await connection.commit();
        return { kind: 'duplicate' };
      }

      // Step 3: Fetch Booking Status
      const [bookingStatus] = await connection.query('SELECT * FROM booking_status WHERE eventId = ?', [course_event_id]);
      if (bookingStatus.length === 0) {
        await connection.rollback();
        return { kind: 'event_missing' };
      }

      const { courseId, eventId, course_cost } = bookingStatus[0];

      // Step 4: Create Booking
      const [bookingResult] = await connection.query(`
        INSERT INTO bookings (course_id, course_event_id, user_id, booking_made_by_id, booking_made_by, type_of_book, spaces,
          payment_due, total_fees, vatrate, vat, total_amount, status, lockid, created, modified, admin_payment_received,
          is_promo_applied, promo_code_id, promo_code_data)
        VALUES (?, ?, 0, 5, 'admin', 'r', 1, ?, ?, 0, 0, ?, 0, ?, NOW(), NOW(), ?, 0, 0, ?)
      `, [courseId, eventId, course_cost, course_cost, course_cost, space_hold_id, course_cost, JSON.stringify({original_amount: []})]);

      const bookingId = bookingResult.insertId;
      console.log(`[BOOKING STATUS] INSERT bookings status=0 (PENDING_PAYMENT) | source=controllers/confirmBooking.js (RideTo step 4) | booking_id=${bookingId} | course_event_id=${eventId} | rideto_order_number=${rideto_order_number}`);
      const booking_ref = `1SRC${bookingId}`;
      const vehicleType = mapBikeHireToVehicleType(resolvedBikeHire);

      // Step 5 & 6: Save Attendee to dropdown
      const cleanedPhone = (phone || '').replace(/\s+/g, '');
      const upperLicence = (driving_licence || '').trim().toUpperCase();
      const fullName = `${first_name} ${last_name || ''} (rt#${rideto_order_number})`.trim();
      const dobMysql = parseDobToMysql(date_of_birth);

      let contactCardId;
      if (upperLicence) {
        const [existingCard] = await connection.query(
          'SELECT id FROM booking_attendees_dropdown WHERE UPPER(TRIM(license_number)) = ? ORDER BY id ASC LIMIT 1',
          [upperLicence]
        );
        if (existingCard.length > 0) {
          contactCardId = existingCard[0].id;
          await connection.query(
            `UPDATE booking_attendees_dropdown
             SET booking_id = ?, booking_ref = ?, first_name = ?, sur_name = ?, contact1 = ?, email = ?, license_number = ?, rideto_orderid = ?, date_of_birth = ?, updated = NOW()
             WHERE id = ?`,
            [bookingId, booking_ref, first_name, last_name, cleanedPhone, email || '', upperLicence, rideto_order_number, dobMysql, contactCardId]
          );
        } else {
          const [cardResult] = await connection.query(`INSERT INTO booking_attendees_dropdown (booking_id, booking_ref, first_name, sur_name, contact1, email, license_number, rideto_orderid, date_of_birth, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [bookingId, booking_ref, first_name, last_name, cleanedPhone, email || '', upperLicence, rideto_order_number, dobMysql]);
          contactCardId = cardResult.insertId;
        }
      } else {
        const [cardResult] = await connection.query(`INSERT INTO booking_attendees_dropdown (booking_id, booking_ref, first_name, sur_name, contact1, email, license_number, rideto_orderid, date_of_birth, created, updated) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, NOW(), NOW())`,
          [bookingId, booking_ref, first_name, last_name, cleanedPhone, email || '', rideto_order_number, dobMysql]);
        contactCardId = cardResult.insertId;
      }

      // Step 7: Insert into booking_attendees
      await connection.query(`
        INSERT INTO booking_attendees (booking_ref, booking_id, first_name, sur_name, contact1, contact2, contact3, email,
          vehicle_type, license_type, license_number, theory_number, admin_notes, notes, date_of_birth, \`primary\`, created, previousparent,
          rideto_orderid, contact_card_id)
        VALUES (?, ?, ?, ?, ?, '', '', ?, ?, 1, ?, '', '', '', ?, 1, NOW(), '', ?, ?)
      `, [booking_ref, bookingId, first_name, last_name, cleanedPhone, email || '', vehicleType, upperLicence, dobMysql, rideto_order_number, contactCardId]);

      // Step 8: Check/Insert User
      if (email) {
        const [existingUser] = await connection.query('SELECT id FROM users WHERE email = ?', [email]);
        let userId;
        if (existingUser.length === 0) {
          const [userResult] = await connection.query(`INSERT INTO users (first_name, sur_name, email, contact1, reg_type, status, created) VALUES (?, ?, ?, ?, 'g', 1, NOW())`,
            [first_name, last_name || '', email, cleanedPhone]);
          userId = userResult.insertId;
        } else {
          userId = existingUser[0].id;
        }
        await connection.query('UPDATE bookings SET user_id = ? WHERE id = ?', [userId, bookingId]);
      }

      // Step 9: Complete Booking
      await connection.query('UPDATE bookings SET payment_due = payment_due - admin_payment_received, status = 1 WHERE id = ?', [bookingId]);
      console.log(`[BOOKING STATUS] UPDATE bookings status=1 (CONFIRMED) | source=controllers/confirmBooking.js (RideTo step 9) | booking_id=${bookingId}`);
      await connection.query(`INSERT INTO booking_payments (booking_id, payment_type, transation_id, response, amount, created) VALUES (?, 'CASH', '', '', ?, NOW())`, [bookingId, course_cost]);

      // Step 10: Update Course Events
      const [eventParent] = await connection.query('SELECT parent FROM course_events WHERE id = ?', [course_event_id]);
      if (eventParent.length > 0) {
        await connection.query('UPDATE course_events SET bookings_done = bookings_done + 1 WHERE parent = ?', [eventParent[0].parent]);
      }

      // Step 10.5: Build booking confirmation email payload (still inside txn, read-only joins)
      const bookingEmailData = await buildBookingEmailData(connection, {
        bookingId,
        booking_ref,
        first_name,
        last_name: last_name || '',
        rideto_order_number,
        bike_hire: resolvedBikeHire,
        course_type,
        location,
        courseId,
        course_event_id
      });

      // Step 11: Remove Lock
      await removeCurLock(connection, space_hold_id);

      await connection.commit();
      return {
        kind: 'committed',
        bookingId,
        booking_ref,
        vehicleType,
        bookingEmailData,
        eventParent: eventParent && eventParent[0] ? eventParent[0].parent : null
      };
    } catch (error) {
      try { await connection.rollback(); } catch (_) {}
      throw error;
    } finally {
      connection.release();
    }
  };

  // Retry the whole transaction up to 3 times on MySQL deadlocks
  // (errno 1213 / sqlState 40001). This is the canonical handling: the
  // deadlock victim is rolled back to a clean state by InnoDB, so it is safe
  // (and required) to retry the entire unit of work.
  const MAX_ATTEMPTS = 3;
  const cbT0 = Date.now();
  let result = null;
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      result = await runTransaction();
      if (attempt > 1) {
        console.warn(`[confirmBooking] runId=${cbRunId} succeeded after deadlock retry attempt=${attempt} course_event_id=${course_event_id}`);
      }
      break;
    } catch (error) {
      lastError = error;
      if (isDeadlockError(error) && attempt < MAX_ATTEMPTS) {
        console.warn(`[confirmBooking] runId=${cbRunId} attempt=${attempt} DEADLOCK sqlState=${error.sqlState} errno=${error.errno} course_event_id=${course_event_id}; retrying...`);
        continue;
      }
      console.error(`[confirmBooking] runId=${cbRunId} attempt=${attempt} ms=${Date.now() - cbT0} ERROR sqlState=${error && error.sqlState} errno=${error && error.errno} course_event_id=${course_event_id} msg=${error && error.sqlMessage}`);
      logRequest(500, 'Database error', { error: error.message, runId: cbRunId, attempt });
      console.error('Error confirming booking:', error);
      return res.status(400).json({ message: 'Course is not available', school_course_id });
    }
  }

  if (!result) {
    // Defensive: shouldn't happen, but if every attempt threw a deadlock we already returned above.
    return res.status(400).json({ message: 'Course is not available', school_course_id });
  }

  // Branch on transactional outcome
  if (result.kind === 'lock_missing') {
    logRequest(402, 'Course is not locked', { school_course_id });
    return res.status(400).json({ message: 'Course is not locked', school_course_id });
  }
  if (result.kind === 'duplicate') {
    logRequest(200, 'Course is already confirmed', { school_course_id }, ALREADY_CONFIRMED_LOG);
    return res.status(200).json({ message: 'Course is confirmed', school_course_id });
  }
  if (result.kind === 'event_missing') {
    logRequest(404, 'Course event not found', { course_event_id });
    return res.status(400).json({ message: 'Course is not available', school_course_id });
  }

  // result.kind === 'committed'
  const { bookingId, booking_ref, vehicleType, bookingEmailData, eventParent } = result;
  logRequest(200, 'Bike hire mapping resolved', { rideto_order_number, bike_hire, bike_hire_type, resolvedBikeHire, vehicleType });
  logRequest(200, 'Attendee saved', { booking_ref, bookingId }, AFTER_SAVE_ATTENDEE_LOG);
  if (eventParent) {
    logRequest(200, 'Bookings done incremented', { parent: eventParent }, ADD_BOOKINGS_DONE_LOG);
  }

  // Step 12: Send Email (and persist email_logs for audit; same table shape as other booking mail)
  await sendBookingEmail(bookingEmailData, pool, {
    booking_ref,
    ip: req.clientIp || '',
    attendeeEmail: email || ''
  });

  logRequest(200, 'Course is confirmed', { school_course_id, booking_ref });
  return res.status(200).json({ message: 'Course is confirmed', school_course_id, booking_ref });
};

module.exports = confirmBooking;
