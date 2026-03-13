const fs = require('node:fs');
const path = require('node:path');

const LOG_FILE = path.join(__dirname, '../../restapi/booking/hold_space.txt');

const ensureLogDir = () => {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const logMessage = (message, data = null) => {
  ensureLogDir();
  const timestamp = new Date().toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).replace(',', '');

  const payload = data ? ` :: ${JSON.stringify(data)}` : '';
  fs.appendFileSync(LOG_FILE, `[${timestamp}] ${message}${payload}\n`);
};

const DATE_REGEX = /^\d{4}-(?:01|02|03|04|05|06|07|08|09|10|11|12)-(?:01|02|03|04|05|06|07|08|09|10|11|12|13|14|15|16|17|18|19|20|21|22|23|24|25|26|27|28|29|30|31)$/;
const TIME_REGEX = /^(?:00|01|02|03|04|05|06|07|08|09|10|11|12|13|14|15|16|17|18|19|20|21|22|23):(?:00|01|02|03|04|05|06|07|08|09|10|11|12|13|14|15|16|17|18|19|20|21|22|23|24|25|26|27|28|29|30|31|32|33|34|35|36|37|38|39|40|41|42|43|44|45|46|47|48|49|50|51|52|53|54|55|56|57|58|59)$/;
const TIME_FORMAT_REGEX = /^\d{2}:\d{2}$/;

const validateTime = (value) => {
  if (!TIME_FORMAT_REGEX.test(value)) {
    return false;
  }
  return TIME_REGEX.test(value);
};

const validateRequest = (body) => {
  const errors = {};

  if (!body.school_course_id) {
    errors.school_course_id = ['School course id is required field'];
  }

  if (!body.location) {
    errors.location = ['Location is required field'];
  }

  if (!body.course_type) {
    errors.course_type = ['Course type is required field'];
  }

  if (!body.date) {
    errors.date = ['Date is required field'];
  } else if (!DATE_REGEX.test(body.date)) {
    errors.date = ['Date has wrong format. Use one of these formats instead: YYYY-MM-DD.'];
  }

  if (!body.start_time) {
    errors.start_time = ['Start time is required field'];
  } else if (!validateTime(body.start_time)) {
    errors.start_time = ['Time has wrong format. Use one of these formats instead: hh:mm.'];
  }

  if (!body.finish_time) {
    errors.finish_time = ['Finish time is required field'];
  } else if (!validateTime(body.finish_time)) {
    errors.finish_time = ['Time has wrong format. Use one of these formats instead: hh:mm.'];
  }

  if (!body.bike_hire_type) {
    errors.bike_hire_type = ['Bike hire type is required field'];
  }

  return Object.keys(errors).length > 0 ? errors : null;
};

const checkAvailability = async (pool, params) => {
  const {
    school_course_id,
    location,
    course_type,
    date,
    start_time,
    finish_time,
  } = params;

  const filters = [
    'courseId = ?'
  ];
  const values = [school_course_id];

  if (course_type === 'LICENCE_CBT') {
    filters.push("course_name = 'CBT'");
  }

  if (location) {
    filters.push('address4 = ?');
    values.push(location);
  }

  if (date) {
    filters.push('event_date = ?');
    values.push(date);
  }

  if (start_time) {
    filters.push('event_start_time = ?');
    values.push(start_time);
  }

  if (finish_time) {
    filters.push('event_end_time = ?');
    values.push(finish_time);
  }

  const query = `
    SELECT courseId, eventId, course_name, address4, event_date, event_start_time, event_end_time, availableSpace, vehicle_automatic
    FROM booking_status
    WHERE ${filters.join(' AND ')}
    LIMIT 1
  `;

  const [rows] = await pool.query(query, values);
  return rows && rows.length > 0 ? rows[0] : null;
};

const lockBooking = async (pool, eventId, spaceRequired) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [parentRows] = await conn.query(
      'SELECT id, parent FROM course_events WHERE parent = (SELECT parent FROM course_events WHERE id = ?)',
      [eventId]
    );

    if (!parentRows || parentRows.length === 0) {
      await conn.rollback();
      return null;
    }

    const parentEvent = parentRows[0];

    const [insertResult] = await conn.query(
      `INSERT INTO lock_bookings
        SET event_id = ?,
            parent = ?,
            space_required = ?,
            automatic_lock = 1,
            manual_lock = 0,
            locked_by = 'ride2',
            created = NOW(),
            modified = NOW(),
            user_id = -1,
            payment_page_stauts = 1`,
      [eventId, parentEvent.parent, spaceRequired]
    );

    await conn.query(
      'UPDATE course_events SET current_locks = current_locks + 1 WHERE id = ?',
      [parentEvent.id]
    );

    await conn.commit();

    return {
      id: insertResult.insertId,
      parent: parentEvent.parent,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

const holdSpace = (pool) => async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method "GET" not allowed.' });
  }

  const validationErrors = validateRequest(req.body || {});
  if (validationErrors) {
    logMessage('Validation failed', validationErrors);
    return res.status(404).json(validationErrors);
  }

  const params = {
    school_course_id: req.body.school_course_id,
    location: req.body.location,
    course_type: req.body.course_type,
    date: req.body.date,
    start_time: req.body.start_time,
    finish_time: req.body.finish_time,
    bike_hire_type: req.body.bike_hire_type,
  };

  try {
    const availability = await checkAvailability(pool, params);

    if (!availability) {
      return res.status(404).json({ message: 'Course id not found.' });
    }

    const availableSpace = Number(availability.availableSpace || 0);
    if (availableSpace < 1) {
      logMessage('Course is not available.', { school_course_id: params.school_course_id });
      return res.status(400).json({
        message: 'Course is not available.',
        school_course_id: params.school_course_id,
      });
    }

    const holdRow = await checkAvailability(pool, params);
    if (!holdRow) {
      logMessage('Course is not available.', { school_course_id: params.school_course_id });
      return res.status(400).json({
        message: 'Course is not available.',
        school_course_id: params.school_course_id,
      });
    }

    const lock = await lockBooking(pool, holdRow.eventId, 1);
    if (!lock) {
      logMessage('Course is not available.', { school_course_id: params.school_course_id });
      return res.status(400).json({
        message: 'Course is not available.',
        school_course_id: params.school_course_id,
      });
    }

    return res.status(200).json({
      message: 'Course is reserved.',
      space_hold_id: lock.id,
      school_course_id: params.school_course_id,
      course_event_id: holdRow.eventId,
    });
  } catch (err) {
    logMessage(`Error: ${err.message}`);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = holdSpace;
