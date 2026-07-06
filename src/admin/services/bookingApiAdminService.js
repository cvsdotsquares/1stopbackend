/**
 * RideTo API parity for course event wizard saves.
 * Matches bookingapi.class.php: no-ops when settings.is_r2api_setting = 0
 * or when RIDETO_API_URL / RIDETO_AUTHORIZATION_KEY are not configured.
 */

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function isRideToConfigured() {
  return Boolean(trim(process.env.RIDETO_API_URL) && trim(process.env.RIDETO_AUTHORIZATION_KEY));
}

async function isRideToEnabled(pool) {
  if (!isRideToConfigured()) {
    return false;
  }
  try {
    const [rows] = await pool.query(
      'SELECT is_r2api_setting FROM settings WHERE id = 1 LIMIT 1'
    );
    const row = rows[0];
    return row && Number(row.is_r2api_setting) !== 0;
  } catch {
    return false;
  }
}

async function rideToRequest(_pool, _method, _path, _body) {
  const enabled = await isRideToEnabled(_pool);
  if (!enabled) {
    return { skipped: true, reason: 'RideTo API disabled or not configured' };
  }
  // Full HTTP parity deferred — PHP bookingapi.class.php uses cURL to RIDETO_API_URL.
  // Wizard DB writes succeed; external sync is skipped when credentials are absent.
  return { skipped: true, reason: 'RideTo sync not implemented in admin API yet' };
}

async function createApiEventCourse(pool, eventId) {
  return rideToRequest(pool, 'POST', 'create-course', { eventId });
}

async function updateApiEventCourse(pool, eventId) {
  return rideToRequest(pool, 'POST', 'update-course', { eventId });
}

async function deleteApiEventCourse(pool, eventId) {
  return rideToRequest(pool, 'POST', 'delete-course', { eventId });
}

async function freezeApiEventCourse(pool, eventId) {
  return rideToRequest(pool, 'POST', 'freeze-course', { eventId });
}

module.exports = {
  isRideToConfigured,
  isRideToEnabled,
  createApiEventCourse,
  updateApiEventCourse,
  deleteApiEventCourse,
  freezeApiEventCourse,
};
