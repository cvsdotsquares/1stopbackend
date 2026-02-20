const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

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

  if (!body.bike_hire) errors.bike_hire = ['Bike hire is required field'];
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

const sendBookingEmail = async (bookingData) => {
  const transporter = nodemailer.createTransport({
    host: 'smtp.postmarkapp.com',
    port: 587,
    secure: false,
    auth: {
      user: 'b39d5268-a4be-49ac-8f23-27c74d9126bf',
      pass: 'b39d5268-a4be-49ac-8f23-27c74d9126bf'
    }
  });

  const mailOptions = {
    from: 'info@1stopinstruction.com',
    to: 'bookings@1stopinstruction.com',
    subject: `${bookingData.course_name} Booking Confirmation - ${bookingData.booking_ref}`,
    html: `<p>New booking confirmed:</p>
           <p><strong>Booking Ref:</strong> ${bookingData.booking_ref}</p>
           <p><strong>Name:</strong> ${bookingData.first_name} ${bookingData.last_name}</p>
           <p><strong>Course:</strong> ${bookingData.course_name}</p>
           <p><strong>RideTo Order:</strong> ${bookingData.rideto_order_number}</p>`
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

  const { school_course_id, course_event_id, space_hold_id, rideto_order_number, first_name, last_name, phone, email, driving_licence } = req.body;

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
      VALUES (?, ?, ?, ?, ?, '', '', ?, 1, 1, ?, '', '', '', 1, NOW(), '', ?, ?)
    `, [booking_ref, bookingId, first_name, fullName, cleanedPhone, email || '', upperLicence, rideto_order_number, contactCardId]);

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

    // Step 11: Remove Lock
    await removeCurLock(connection, space_hold_id);

    await connection.commit();

    // Step 12: Send Email
    await sendBookingEmail({
      booking_ref,
      course_name: bookingStatus[0].course_name || 'Course',
      first_name,
      last_name: last_name || '',
      rideto_order_number
    });

    logRequest(200, 'Course is confirmed', { school_course_id, booking_ref });
    return res.status(200).json({ message: 'Course is confirmed', school_course_id, booking_ref });

  } catch (error) {
    await connection.rollback();
    logRequest(500, 'Database error', { error: error.message });
    return res.status(400).json({ message: 'Course is not available', school_course_id });
  } finally {
    connection.release();
  }
};

module.exports = confirmBooking;
