const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { replaceTokens } = require('../utils/tokenReplacer');

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

  if (normalizedBikeHire === '1') return 1;
  if (normalizedBikeHire === '3') return 3;
  if (normalizedBikeHire === 'automatic' || normalizedBikeHire === 'auto') return 1;
  if (normalizedBikeHire === 'own' || normalizedBikeHire === 'own_vehicle' || normalizedBikeHire === 'own vehicle') return 3;
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

  const booking = bookingTotals[0] || {};
  const course = courseData[0] || {};
  const locationInfo = locationData[0] || {};
  const franchise = franchiseData[0] || {};
  const vehicleType = mapBikeHireToVehicleType(bike_hire);

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
    booking_type: String(booking.type_of_book || 'R2').toUpperCase(),
    first_name,
    sur_name: last_name || '',
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

const sendBookingEmail = async (bookingData) => {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: parseBooleanEnv(process.env.SMTP_SECURE, false),
    auth: process.env.SMTP_USER && process.env.SMTP_PASS
      ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
      : undefined
  });

  const fromAddress = process.env.CONTACT_FROM;
  const toAddress = process.env.CONTACT_TO;

  if (!fromAddress || !toAddress) {
    console.error('Booking email config missing: CONTACT_FROM/BOOKING_BCC');
    return false;
  }

  const mailOptions = {
    from: fromAddress,
    to: toAddress,
    subject: buildSubject(bookingData),
    html: buildBookingConfirmationHtml(bookingData),
    text: buildBookingConfirmationText(bookingData)
  };

  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('Email error:', error);
    return false;
  }
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
    bike_hire,
    bike_hire_type,
    course_type,
    location
  } = req.body;

  const resolvedBikeHire = bike_hire || bike_hire_type || '';

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Step 1: Validate Space Lock
    const [lockCheck] = await connection.query('SELECT id FROM lock_bookings WHERE event_id = ? AND id = ?', [course_event_id, space_hold_id]);
    if (lockCheck.length === 0) {
      await connection.rollback();
      logRequest(402, 'Course is not locked', { school_course_id });
      return res.status(400).json({ message: 'Course is not locked', school_course_id });
    }

    // Step 2: Check Duplicate Order
    const [dupCheck1] = await connection.query('SELECT id FROM booking_attendees WHERE rideto_orderid = ?', [rideto_order_number]);
    const [dupCheck2] = await connection.query('SELECT id FROM booking_attendees_dropdown WHERE rideto_orderid = ?', [rideto_order_number]);

    if (dupCheck1.length > 0 || dupCheck2.length > 0) {
      await removeCurLock(connection, space_hold_id);
      await connection.commit();
      logRequest(200, 'Course is already confirmed', { school_course_id }, ALREADY_CONFIRMED_LOG);
      return res.status(200).json({ message: 'Course is confirmed', school_course_id });
    }

    // Step 3: Fetch Booking Status
    const [bookingStatus] = await connection.query('SELECT * FROM booking_status WHERE eventId = ?', [course_event_id]);
    if (bookingStatus.length === 0) {
      await connection.rollback();
      logRequest(404, 'Course event not found', { course_event_id });
      return res.status(400).json({ message: 'Course is not available', school_course_id });
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
    const booking_ref = `1SRC${bookingId}`;
    const vehicleType = mapBikeHireToVehicleType(resolvedBikeHire);
    logRequest(200, 'Bike hire mapping resolved', {
      rideto_order_number,
      bike_hire,
      bike_hire_type,
      resolvedBikeHire,
      vehicleType
    });

    // Step 5 & 6: Save Attendee to dropdown
    const cleanedPhone = (phone || '').replace(/\s+/g, '');
    const upperLicence = (driving_licence || '').trim().toUpperCase();
    const fullName = `${first_name} ${last_name || ''} (rt#${rideto_order_number})`.trim();

    let contactCardId;
    if (upperLicence) {
      const [existingCard] = await connection.query('SELECT id FROM booking_attendees_dropdown WHERE license_number = ?', [upperLicence]);
      if (existingCard.length > 0) {
        contactCardId = existingCard[0].id;
        await connection.query(`UPDATE booking_attendees_dropdown SET first_name = ?, sur_name = ?, contact1 = ?, email = ?, rideto_orderid = ? WHERE id = ?`,
          [first_name, fullName, cleanedPhone, email || '', rideto_order_number, contactCardId]);
      } else {
        const [cardResult] = await connection.query(`INSERT INTO booking_attendees_dropdown (first_name, sur_name, contact1, email, license_number, rideto_orderid, created) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
          [first_name, fullName, cleanedPhone, email || '', upperLicence, rideto_order_number]);
        contactCardId = cardResult.insertId;
      }
    } else {
      const [cardResult] = await connection.query(`INSERT INTO booking_attendees_dropdown (first_name, sur_name, contact1, email, license_number, rideto_orderid, created) VALUES (?, ?, ?, ?, '', ?, NOW())`,
        [first_name, fullName, cleanedPhone, email || '', rideto_order_number]);
      contactCardId = cardResult.insertId;
    }

    // Step 7: Insert into booking_attendees
    await connection.query(`
      INSERT INTO booking_attendees (booking_ref, booking_id, first_name, sur_name, contact1, contact2, contact3, email,
        vehicle_type, license_type, license_number, theory_number, admin_notes, notes, \`primary\`, created, previousparent,
        rideto_orderid, contact_card_id)
      VALUES (?, ?, ?, ?, ?, '', '', ?, ?, 1, ?, '', '', '', 1, NOW(), '', ?, ?)
    `, [booking_ref, bookingId, first_name, fullName, cleanedPhone, email || '', vehicleType, upperLicence, rideto_order_number, contactCardId]);

    logRequest(200, 'Attendee saved', { booking_ref, bookingId }, AFTER_SAVE_ATTENDEE_LOG);

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
    await connection.query(`INSERT INTO booking_payments (booking_id, payment_type, transation_id, response, amount, created) VALUES (?, 'CASH', '', '', ?, NOW())`, [bookingId, course_cost]);

    // Step 10: Update Course Events
    const [eventParent] = await connection.query('SELECT parent FROM course_events WHERE id = ?', [course_event_id]);
    if (eventParent.length > 0) {
      await connection.query('UPDATE course_events SET bookings_done = bookings_done + 1 WHERE parent = ?', [eventParent[0].parent]);
      logRequest(200, 'Bookings done incremented', { parent: eventParent[0].parent }, ADD_BOOKINGS_DONE_LOG);
    }

    // Step 10.5: Build booking confirmation email payload
    const bookingEmailData = await buildBookingEmailData(connection, {
      bookingId,
      booking_ref,
      first_name,
      last_name: last_name || '',
      bike_hire: resolvedBikeHire,
      course_type,
      location,
      courseId,
      course_event_id
    });

    // Step 11: Remove Lock
    await removeCurLock(connection, space_hold_id);

    await connection.commit();

    // Step 12: Send Email
    await sendBookingEmail(bookingEmailData);

    logRequest(200, 'Course is confirmed', { school_course_id, booking_ref });
    return res.status(200).json({ message: 'Course is confirmed', school_course_id, booking_ref });

  } catch (error) {
    await connection.rollback();
    logRequest(500, 'Database error', { error: error.message });
    console.error('Error confirming booking:', error);
    return res.status(400).json({ message: 'Course is not available', school_course_id });
  } finally {
    connection.release();
  }
};

module.exports = confirmBooking;
