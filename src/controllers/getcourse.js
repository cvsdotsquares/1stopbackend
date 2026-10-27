const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../../getcourse.txt');

const logError = (message) => {
  const timestamp = new Date().toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).replace(',', '');

  const logEntry = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, logEntry);
};

/**
 * Controller for GET /restapi/booking/getcourse
 * Matches PHP behavior of restapi/booking/getcourse.php
 */
const getCourse = (pool) => async (req, res) => {
  // Validate HTTP method
  if (req.method !== 'GET') {
    return res.status(405).json({ message: `Method "${req.method}" not allowed.` });
  }

  try {
    // Step 1: Check settings flag
    const [settingsRows] = await pool.query(
      'SELECT is_r2api_setting FROM settings WHERE id = 1'
    );

    if (!settingsRows || settingsRows.length === 0) {
      // No settings row found, treat as disabled
      return res.status(200).json({ course: [] });
    }

    const settings = settingsRows[0];

    if (settings.is_r2api_setting === 0) {
      // API is disabled
      return res.status(200).json({ course: [] });
    }

    // Step 2: Fetch courses from booking_status for specific locations
    const locationIds = [1, 4, 15, 18];
    const placeholders = locationIds.map(() => '?').join(',');

    const [courseRows] = await pool.query(
      `SELECT
        CourseEventId,
        rideto_course_id,
        course_name,
        location_name,
        event_date,
        event_start_time,
        event_end_time,
        booking_limit,
        bookings_done,
        current_locks,
        freezeBooking,
        vehicle_automatic,
        location_id
      FROM booking_status
      WHERE location_id IN (${placeholders})`,
      locationIds
    );

    // Step 3: If no courses found, return 404
    if (!courseRows || courseRows.length === 0) {
      logError('404 - Course is not available.');
      return res.status(404).json({ message: 'Course is not available.' });
    }

    // Step 4: Transform rows and calculate AvailSeatCount
    const courses = courseRows.map((row) => {
      // Handle null values for calculations
      const bookingLimit = row.booking_limit || 0;
      const bookingsDone = row.bookings_done || 0;
      const currentLocks = row.current_locks || 0;

      // Calculate available seats
      let availSeatCount = bookingLimit - bookingsDone - currentLocks;

      // If freezeBooking is 1, force AvailSeatCount to 0
      if (row.freezeBooking === 1) {
        availSeatCount = 0;
      }

      // Ensure it doesn't go below 0
      if (availSeatCount < 0) {
        availSeatCount = 0;
      }

      return {
        CourseEventId: row.CourseEventId,
        RidetoCourseId: row.rideto_course_id,
        course_name: row.course_name,
        location_name: row.location_name,
        event_date: row.event_date instanceof Date
          ? `${row.event_date.getFullYear()}-${String(row.event_date.getMonth() + 1).padStart(2, '0')}-${String(row.event_date.getDate()).padStart(2, '0')}`
          : (row.event_date || null),
        event_start_time: row.event_start_time,
        event_end_time: row.event_end_time,
        AvailSeatCount: availSeatCount,
        automatic_booking: row.vehicle_automatic,
        booking_limit: bookingLimit,
        bookings_done: bookingsDone,
        current_locks: currentLocks
      };
    });

    // Step 5: Return successful response
    res.status(200).json({ course: courses });

  } catch (err) {
    console.error('Error in getCourse:', err);
    logError(`Error: ${err.message}`);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = getCourse;
