const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../../check_availability.log');

const logRequest = (status, message, data = null) => {
  const timestamp = new Date().toLocaleString('en-GB', { 
    day: '2-digit', 
    month: '2-digit', 
    year: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false 
  }).replace(',', '');
  
  const logEntry = `[${timestamp}] :: Status:${status} -- ${message} >> ${data ? JSON.stringify(data) : 'N/A'}\n`;
  fs.appendFileSync(LOG_FILE, logEntry);
};

const validateRequest = (body) => {
  const errors = {};

  if (!body.school_course_id) {
    errors.school_course_id = ['School course id is required field'];
  } else if (!Number.isInteger(Number(body.school_course_id))) {
    errors.school_course_id = ['School course id must be an integer'];
  }

  if (!body.location) {
    errors.location = ['Location is required field'];
  }

  if (!body.course_type) {
    errors.course_type = ['Course type is required field'];
  }

  if (!body.date) {
    errors.date = ['Date is required field'];
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    errors.date = ['Date has wrong format. Use one of these formats instead: YYYY-MM-DD.'];
  }

  if (!body.start_time) {
    errors.start_time = ['Start time is required field'];
  } else if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(body.start_time)) {
    errors.start_time = ['Time has wrong format. Use one of these formats instead: hh:mm.'];
  }

  if (!body.finish_time) {
    errors.finish_time = ['Finish time is required field'];
  } else if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(body.finish_time)) {
    errors.finish_time = ['Time has wrong format. Use one of these formats instead: hh:mm.'];
  }

  if (!body.bike_hire_type) {
    errors.bike_hire_type = ['Bike hire type is required field'];
  }

  return Object.keys(errors).length > 0 ? errors : null;
};

const checkAvailability = (pool) => async (req, res) => {
  if (req.method !== 'POST') {
    logRequest(405, 'Method not allowed', { method: req.method });
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const validationErrors = validateRequest(req.body);
  if (validationErrors) {
    logRequest(400, 'Validation failed', validationErrors);
    return res.status(400).json(validationErrors);
  }

  const { school_course_id, location, course_type, date, start_time, finish_time } = req.body;

  try {
    const query = `
      SELECT 
        courseId, 
        eventId, 
        course_name, 
        address4, 
        event_date, 
        event_start_time, 
        event_end_time, 
        availableSpace, 
        vehicle_automatic
      FROM booking_status
      WHERE courseId = ?
        AND address4 = ?
        AND event_date = ?
        AND event_start_time = ?
        AND event_end_time = ?
        ${course_type === 'LICENCE_CBT' ? "AND course_name = 'CBT'" : ''}
    `;

    const [results] = await pool.query(query, [
      school_course_id,
      location,
      date,
      start_time,
      finish_time
    ]);

    if (results.length === 0) {
      logRequest(404, 'Course is not available', { school_course_id });
      return res.status(404).json({ message: 'Course is not available' });
    }

    const course = results[0];

    if (course.availableSpace >= 1) {
      const response = {
        message: 'Course is available',
        is_available: true,
        availableSpace: course.availableSpace,
        school_course_id
      };
      logRequest(200, 'Course available', response);
      return res.status(200).json(response);
    } else {
      const response = {
        message: 'Course is not available',
        is_available: false,
        school_course_id
      };
      logRequest(400, 'No available space', response);
      return res.status(400).json(response);
    }
  } catch (error) {
    logRequest(500, 'Database error', { error: error.message });
    return res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = checkAvailability;
