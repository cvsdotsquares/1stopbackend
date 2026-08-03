/**
 * F-021 — Bulk day freeze (legacy admin_day_freeze.php).
 * Sets course_event_dates.freeze for all dates on a calendar day.
 */

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

async function listCourseEventDateIdsForDay(pool, day) {
  const [rows] = await pool.query(
    `SELECT id AS course_event_date_id, course_event_id, freeze
     FROM course_event_dates
     WHERE event_date = ?`,
    [day]
  );
  return rows || [];
}

async function getDayFreezePreview(pool, dayRaw) {
  const day = String(dayRaw || '').trim();
  if (!isIsoDate(day)) {
    const err = new Error('Invalid day');
    err.status = 400;
    throw err;
  }

  const rows = await listCourseEventDateIdsForDay(pool, day);
  const frozen = rows.filter((row) => Number(row.freeze) === 1).length;
  const active = rows.filter((row) => Number(row.freeze) !== 1).length;

  return {
    day,
    total_dates: rows.length,
    frozen_count: frozen,
    active_count: active,
  };
}

async function bulkDayFreeze(pool, dayRaw, fstatusRaw) {
  const day = String(dayRaw || '').trim();
  const fstatus = Number(fstatusRaw);

  if (!isIsoDate(day)) {
    const err = new Error('Invalid day');
    err.status = 400;
    throw err;
  }
  if (![1, 2].includes(fstatus)) {
    const err = new Error('Invalid freeze status');
    err.status = 400;
    throw err;
  }

  const rows = await listCourseEventDateIdsForDay(pool, day);
  if (!rows.length) {
    return {
      day,
      fstatus,
      updated: 0,
      message: 'No course event dates found for this day',
    };
  }

  let updated = 0;
  for (const row of rows) {
    const [result] = await pool.query(
      `UPDATE course_event_dates
       SET freeze = ?
       WHERE id = ? AND course_event_id = ?`,
      [fstatus, row.course_event_date_id, row.course_event_id]
    );
    updated += Number(result?.affectedRows) || 0;
  }

  return {
    day,
    fstatus,
    updated,
    message: `Course event ${fstatus === 1 ? 'freeze' : 'unfreeze'} successfully`,
  };
}

module.exports = {
  getDayFreezePreview,
  bulkDayFreeze,
};
