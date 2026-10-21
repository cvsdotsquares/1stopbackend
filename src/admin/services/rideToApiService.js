const RIDETO_LOCATIONS = {
  1: '1-stop-instruction-ilford',
  4: '1-stop-instruction-tottenham',
  15: '1-stop-instruction-beckton',
  18: '1-stop-instruction-barnet',
};

const RIDETO_LOCATION_IDS = [1, 4, 15, 18];

/**
 * Returns configuration for RideTo API connect endpoints.
 * Staging vs Live can be toggled by RIDE2_API_LIVE env or RIDETO_API_URL / RIDETO_AUTHORIZATION_KEY.
 */
function getRideToConfig() {
  const isLive = process.env.RIDE2_API_LIVE !== undefined
    ? (process.env.RIDE2_API_LIVE === '1' || process.env.RIDE2_API_LIVE === 'true' || process.env.RIDE2_API_LIVE === 1)
    : (process.env.NODE_ENV === 'production');

  const defaultUrl = isLive
    ? 'https://www.rideto.com/api/connect/'
    : 'https://bike-tests-staging.herokuapp.com/api/connect/';

  const defaultKey = isLive
    ? 'ae48508240c104969ffda9a7649231135538d987'
    : 'c4601eccfd63b87019ac237458eab0de85ef9367';

  const rawUrl = process.env.RIDETO_API_URL || defaultUrl;
  const apiUrl = rawUrl.endsWith('/') ? rawUrl : `${rawUrl}/`;
  const authKey = process.env.RIDETO_AUTHORIZATION_KEY || defaultKey;

  return { isLive, apiUrl, authKey };
}

/**
 * Checks if a course and location combination qualifies for RideTo sync.
 * CBT course (ID 1) at locations Ilford (1), Tottenham (4), Beckton (15), Barnet (18).
 */
function isRideToEligible(courseId, locationId) {
  return Number(courseId) === 1 && RIDETO_LOCATION_IDS.includes(Number(locationId));
}

/**
 * Checks whether RideTo API integration is enabled in admin settings (settings.is_r2api_setting != 0).
 */
async function isRideToEnabled(db) {
  try {
    const [rows] = await db.query('SELECT is_r2api_setting FROM settings WHERE id = 1');
    if (!rows || rows.length === 0) return false;
    return Number(rows[0].is_r2api_setting) === 1;
  } catch (err) {
    console.error('[RideTo] Error checking is_r2api_setting:', err);
    return false;
  }
}

function formatRideToDate(val) {
  if (!val) return '';
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(val).split('T')[0];
}

function formatRideToTime(val) {
  if (!val) return '00:00:00';
  const parts = String(val).trim().split(':');
  const h = String(parts[0] || '0').padStart(2, '0');
  const m = String(parts[1] || '0').padStart(2, '0');
  const s = String(parts[2] || '0').padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/**
 * Calls RideTo create-course API and updates course_events.rideto_course_id.
 *
 * @param {number} eventId - course_events.id
 * @param {object|null} explicitData - optional pre-fetched event data
 * @param {object} db - database connection or pool
 */
async function createRideToCourse(eventId, explicitData = null, db) {
  try {
    const enabled = await isRideToEnabled(db);
    if (!enabled) {
      return { skipped: true, reason: 'RideTo API is disabled in settings' };
    }

    let eventData = explicitData;
    if (!eventData) {
      const [rows] = await db.query(
        `SELECT 
          ce.id AS eventId,
          ce.course_id AS courseId,
          ce.location_id AS locationId,
          ce.booking_limit AS spaces,
          ce.bookings_done AS bookingsDone,
          ce.current_locks AS currentLocks,
          ced.event_date AS eventDate,
          ced.event_start_time AS startTime,
          ced.event_end_time AS endTime
        FROM course_events ce
        JOIN course_event_dates ced ON ce.id = ced.course_event_id
        WHERE ce.id = ?
        LIMIT 1`,
        [eventId]
      );
      if (!rows || rows.length === 0) {
        return { skipped: true, reason: `Course event ${eventId} not found` };
      }
      eventData = rows[0];
    }

    const courseId = Number(eventData.courseId || eventData.course_id || eventData.course);
    const locationId = Number(eventData.locationId || eventData.location_id);
    if (!isRideToEligible(courseId, locationId)) {
      return { skipped: true, reason: `Course ${courseId} / Location ${locationId} not eligible for RideTo` };
    }

    const rawSpaces = eventData.spaces ?? eventData.booking_limit ?? 0;
    const bookingsDone = eventData.bookingsDone ?? eventData.bookings_done ?? 0;
    const currentLocks = eventData.currentLocks ?? eventData.current_locks ?? 0;
    const availableSpaces = Math.max(0, Number(rawSpaces) - Number(bookingsDone) - Number(currentLocks));

    const eventDate = eventData.date || eventData.eventDate || eventData.event_date;
    const startTime = eventData.startTime || eventData.start_time || eventData.event_start_time;
    const endTime = eventData.endTime || eventData.end_time || eventData.event_end_time;

    const { apiUrl, authKey } = getRideToConfig();
    const locationSlug = RIDETO_LOCATIONS[locationId];

    const payload = {
      course_id: courseId,
      CourseEventId: Number(eventId),
      course_type: 'LICENCE_CBT',
      location: locationSlug,
      spaces: availableSpaces,
      date: formatRideToDate(eventDate),
      start_time: formatRideToTime(startTime),
      finish_time: formatRideToTime(endTime),
      bike_hire_spaces: availableSpaces,
    };

    const targetUrl = `${apiUrl}create-course`;
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${authKey}`,
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    let resResult = null;
    try {
      resResult = JSON.parse(responseText);
    } catch {
      resResult = { raw: responseText };
    }

    if (resResult && resResult.rideto_course_id) {
      await db.query(
        "UPDATE course_events SET rideto_course_id = ?, rideto_api_status = 'on' WHERE id = ?",
        [resResult.rideto_course_id, eventId]
      );
      console.log(`[RideTo] Created RideTo course for event ${eventId} -> rideto_course_id: ${resResult.rideto_course_id}, rideto_api_status: on`);
      return {
        success: true,
        rideto_course_id: resResult.rideto_course_id,
        rideto_api_status: 'on',
        message: resResult.message || 'Course created on RideTo',
      };
    } else {
      console.warn(`[RideTo] Failed to obtain rideto_course_id for event ${eventId}. Status: ${response.status}`, resResult);
      return {
        success: false,
        status: response.status,
        response: resResult,
      };
    }
  } catch (err) {
    console.error(`[RideTo] Error creating RideTo course for event ${eventId}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Updates an existing course event on RideTo (PATCH /course/:rideto_course_id).
 * If rideto_course_id does not exist yet, creates it.
 */
async function updateRideToCourse(eventId, db) {
  try {
    const enabled = await isRideToEnabled(db);
    if (!enabled) {
      return { skipped: true, reason: 'RideTo API is disabled in settings' };
    }

    const [rows] = await db.query(
      `SELECT 
        ce.id AS eventId,
        ce.course_id AS courseId,
        ce.location_id AS locationId,
        ce.booking_limit AS spaces,
        ce.bookings_done AS bookingsDone,
        ce.current_locks AS currentLocks,
        ce.rideto_course_id AS ridetoCourseId,
        ced.event_date AS eventDate,
        ced.event_start_time AS startTime,
        ced.event_end_time AS endTime
      FROM course_events ce
      JOIN course_event_dates ced ON ce.id = ced.course_event_id
      WHERE ce.id = ?
      LIMIT 1`,
      [eventId]
    );

    if (!rows || rows.length === 0) {
      return { skipped: true, reason: `Course event ${eventId} not found` };
    }

    const event = rows[0];
    if (!isRideToEligible(event.courseId, event.locationId)) {
      return { skipped: true, reason: 'Not eligible for RideTo' };
    }

    // If no rideto_course_id exists yet, create it
    if (!event.ridetoCourseId) {
      return await createRideToCourse(eventId, event, db);
    }

    const [freezeRows] = await db.query(
      'SELECT count(id) AS count_freeze FROM freeze WHERE course_event_id = ?',
      [eventId]
    );
    const isFrozen = (freezeRows?.[0]?.count_freeze || 0) > 0;
    if (isFrozen) {
      return { skipped: true, reason: 'Course event is frozen' };
    }

    const rawSpaces = event.spaces ?? 0;
    const bookingsDone = event.bookingsDone ?? 0;
    const currentLocks = event.currentLocks ?? 0;
    const availableSpaces = Math.max(0, Number(rawSpaces) - Number(bookingsDone) - Number(currentLocks));

    const { apiUrl, authKey } = getRideToConfig();
    const locationSlug = RIDETO_LOCATIONS[Number(event.locationId)];

    const payload = {
      course_id: Number(event.courseId),
      course_type: 'LICENCE_CBT',
      location: locationSlug,
      spaces: availableSpaces,
      date: formatRideToDate(event.eventDate),
      start_time: formatRideToTime(event.startTime),
      finish_time: formatRideToTime(event.endTime),
      bike_hire_spaces: availableSpaces,
    };

    const targetUrl = `${apiUrl}course/${event.ridetoCourseId}`;
    const response = await fetch(targetUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${authKey}`,
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    let resResult = null;
    try {
      resResult = JSON.parse(responseText);
    } catch {
      resResult = { raw: responseText };
    }

    if (response.ok) {
      await db.query("UPDATE course_events SET rideto_api_status = 'on' WHERE id = ?", [eventId]).catch(() => { });
    }

    return {
      success: response.ok,
      status: response.status,
      response: resResult,
    };
  } catch (err) {
    console.error(`[RideTo] Error updating RideTo course for event ${eventId}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Marks spaces = 0 on RideTo when course event is deleted.
 */
async function deleteRideToCourse(eventId, explicitRidetoCourseId = null, db = null) {
  try {
    const actualDb = db || (explicitRidetoCourseId && typeof explicitRidetoCourseId === 'object' && explicitRidetoCourseId.query ? explicitRidetoCourseId : null);
    const actualRidetoId = typeof explicitRidetoCourseId === 'number' || typeof explicitRidetoCourseId === 'string' ? explicitRidetoCourseId : null;

    if (actualDb) {
      const enabled = await isRideToEnabled(actualDb);
      if (!enabled) return { skipped: true };
    }

    let ridetoCourseId = actualRidetoId;
    if (!ridetoCourseId && actualDb) {
      const [rows] = await actualDb.query(
        'SELECT rideto_course_id FROM course_events WHERE id = ? LIMIT 1',
        [eventId]
      );
      ridetoCourseId = rows?.[0]?.rideto_course_id;
    }
    if (!ridetoCourseId) {
      return { skipped: true, reason: 'No rideto_course_id found' };
    }

    const { apiUrl, authKey } = getRideToConfig();
    const targetUrl = `${apiUrl}course/${ridetoCourseId}`;

    const response = await fetch(targetUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${authKey}`,
      },
      body: JSON.stringify({ spaces: 0 }),
    });

    if (response.ok && actualDb) {
      await actualDb.query("UPDATE course_events SET rideto_api_status = 'off' WHERE id = ?", [eventId]).catch(() => { });
    }

    return { success: response.ok };
  } catch (err) {
    console.error(`[RideTo] Error deleting RideTo course for event ${eventId}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Freezes (spaces = 0) or unfreezes (spaces = availableSpace) on RideTo.
 */
async function freezeRideToCourse(eventId, action = 'freeze', db) {
  try {
    const enabled = await isRideToEnabled(db);
    if (!enabled) return { skipped: true };

    const [rows] = await db.query(
      `SELECT 
        ce.rideto_course_id,
        ce.booking_limit AS spaces,
        ce.bookings_done AS bookingsDone,
        ce.current_locks AS currentLocks
      FROM course_events ce
      WHERE ce.id = ?
      LIMIT 1`,
      [eventId]
    );

    const event = rows?.[0];
    if (!event || !event.rideto_course_id) {
      return { skipped: true, reason: 'No rideto_course_id found' };
    }

    let spaces = 0;
    if (action === 'unfreeze') {
      spaces = Math.max(0, Number(event.spaces || 0) - Number(event.bookingsDone || 0) - Number(event.currentLocks || 0));
    }

    const { apiUrl, authKey } = getRideToConfig();
    const targetUrl = `${apiUrl}course/${event.rideto_course_id}`;

    const response = await fetch(targetUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${authKey}`,
      },
      body: JSON.stringify({ spaces }),
    });

    if (response.ok) {
      const newStatus = action === 'unfreeze' ? 'on' : 'off';
      await db.query("UPDATE course_events SET rideto_api_status = ? WHERE id = ?", [newStatus, eventId]).catch(() => { });
    }

    return { success: response.ok };
  } catch (err) {
    console.error(`[RideTo] Error in freezeRideToCourse for event ${eventId}:`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  RIDETO_LOCATIONS,
  RIDETO_LOCATION_IDS,
  getRideToConfig,
  isRideToEligible,
  isRideToEnabled,
  createRideToCourse,
  updateRideToCourse,
  deleteRideToCourse,
  freezeRideToCourse,
};
