/**
 * Port of legacy header.php data queries + vehicles.class.php getVehicleHeaderStatus().
 */

async function getCbtCertificatesAvailability(pool) {
  const [rows] = await pool.query(
    `SELECT l.loc_abb AS location_name, COUNT(drc.id) AS available_certificates,
      CASE WHEN COUNT(drc.id) <= 25 THEN 'bg-red' ELSE 'NORMAL' END AS status_color
     FROM dl_return_certificates drc
     INNER JOIN dl_returns dr ON dr.id = drc.dl_return_id
     INNER JOIN locations l ON l.id = dr.location_id
     WHERE dr.certificate_status = 'On-Site'
       AND drc.certificate_voided = 'no'
       AND drc.duplicate_certificate = 'no'
       AND (
         (drc.attendee_id IS NULL OR drc.attendee_id = 0)
         AND (drc.attendee_name IS NULL OR drc.attendee_name = '')
         AND (drc.attendee_licence IS NULL OR drc.attendee_licence = '')
         AND (drc.instructor_id IS NULL OR drc.instructor_id = 0)
         AND (drc.instructor_certificate IS NULL OR drc.instructor_certificate = '')
         AND (drc.completion_date IS NULL OR drc.completion_date = '0000-00-00')
         AND (drc.start_time IS NULL OR drc.start_time = '')
         AND (drc.completion_time IS NULL OR drc.completion_time = '')
         AND (drc.restriction IS NULL OR drc.restriction = '')
         AND (drc.transmission IS NULL OR drc.transmission = '')
       )
     GROUP BY l.id
     ORDER BY l.loc_abb`
  );

  return rows.map((row) => ({
    location_name: row.location_name,
    available_certificates: Number(row.available_certificates),
    status_color: row.status_color,
    location_list_red: row.status_color === 'bg-red',
  }));
}

async function queryVehicleStatusGroup(pool, column, fieldOrder) {
  const fieldList = fieldOrder.map((c) => `'${c}'`).join(', ');
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt, ${column} AS color
     FROM vehicles
     WHERE include_into_alert = 1 AND status = 1
     GROUP BY ${column}
     ORDER BY FIELD(${column}, ${fieldList})`
  );

  return rows.map((row) => ({
    cnt: Number(row.cnt),
    color: row.color,
  }));
}

async function getVehicleHeaderStatus(pool) {
  const [issue, mot, road_tax, service] = await Promise.all([
    queryVehicleStatusGroup(pool, 'issue_color', [
      'green',
      'red',
      'yellow',
      'purple',
    ]),
    queryVehicleStatusGroup(pool, 'mot_color', ['green', 'red', 'yellow']),
    queryVehicleStatusGroup(pool, 'road_tax_color', [
      'green',
      'red',
      'yellow',
      'blue',
    ]),
    queryVehicleStatusGroup(pool, 'service_color', ['green', 'red', 'yellow']),
  ]);

  return { issue, mot, road_tax, service };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function monthName(monthNum) {
  return new Date(2000, Number(monthNum) - 1, 1).toLocaleString('en-GB', {
    month: 'long',
  });
}

function buildMonthPagination(monthCal, yearCal) {
  const month = Number(monthCal);
  const year = Number(yearCal);

  const date = new Date(year, month - 1, 1);
  const prevDate = new Date(year, month - 2, 1);
  const nextDate = new Date(year, month, 1);

  const prevMonth = pad2(prevDate.getMonth() + 1);
  const prevYear = prevDate.getFullYear();
  const nextMonth = pad2(nextDate.getMonth() + 1);
  const nextYear = nextDate.getFullYear();

  let thirdMonth;
  let thirdYear;
  let fourMonth;
  let fourYear;

  if (Number(nextMonth) === 12) {
    thirdMonth = '01';
    thirdYear = nextYear + 1;
    fourMonth = '02';
    fourYear = nextYear + 1;
  } else {
    thirdMonth = pad2(Number(nextMonth) + 1);
    thirdYear = nextYear;
    fourMonth = pad2(Number(nextMonth) + 2);
    fourYear = nextYear;
  }

  if (Number(nextMonth) === 11) {
    fourMonth = '1';
    fourYear = nextYear + 1;
  }

  return {
    monthCal: String(monthCal),
    yearCal: String(year),
    prevMonth,
    prevYear,
    nextMonth,
    nextYear,
    thirdMonth: pad2(thirdMonth),
    thirdYear,
    fourMonth: String(fourMonth),
    fourYear,
    currentMonthLabel: monthName(monthCal),
    nextMonthLabel: monthName(nextMonth),
    thirdMonthLabel: monthName(thirdMonth),
    fourMonthLabel: monthName(fourMonth),
  };
}

function syncCalendarSession(req) {
  const dateParam = req.query.date;

  if (dateParam != null && String(dateParam).trim() !== '') {
    req.session.monthCal = String(dateParam);
    req.session.yearCal = req.query.year
      ? String(req.query.year)
      : String(new Date().getFullYear());
  } else if (!req.session.monthCal) {
    const now = new Date();
    req.session.monthCal = pad2(now.getMonth() + 1);
    req.session.yearCal = String(now.getFullYear());
  }
}

module.exports = {
  getCbtCertificatesAvailability,
  getVehicleHeaderStatus,
  buildMonthPagination,
  syncCalendarSession,
};
