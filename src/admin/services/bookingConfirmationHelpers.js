/**
 * Shared course event display for admin booking confirmation summary.
 */
const TBC_DATE = '0000-00-00';

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function formatLongDate(value) {
  if (!value || value === TBC_DATE || value === 'TBC') return 'TBC';
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(value);
  const weekdays = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const day = d.getDate();
  const suffix =
    day % 10 === 1 && day !== 11
      ? 'st'
      : day % 10 === 2 && day !== 12
        ? 'nd'
        : day % 10 === 3 && day !== 13
          ? 'rd'
          : 'th';
  return `${weekdays[d.getDay()]} ${day}${suffix} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function formatTimeAmPm(timeRange) {
  if (!timeRange) return '';
  const parts = String(timeRange).split('-');
  const formatOne = (t) => {
    const raw = trim(t);
    if (!raw) return '';
    const num = Number(raw.replace(':', '.'));
    const hourPart = trim(raw).replace(/^0+/, '') || '0';
    if (Number.isNaN(num)) return raw;
    return num > 12 ? `${hourPart}pm` : `${hourPart}am`;
  };
  const one = formatOne(parts[0]);
  const two = parts[1] ? formatOne(parts[1]) : '';
  return two ? `${one} - ${two}` : one;
}

function buildEventDatesMap(dateRows) {
  const dates = {};
  let hasTbc = false;
  for (const row of dateRows || []) {
    const raw = row.event_date;
    if (raw && String(raw).slice(0, 10) !== TBC_DATE) {
      dates[String(raw).slice(0, 10)] =
        `${row.event_start_time || ''} - ${row.event_end_time || ''}`;
    } else {
      hasTbc = true;
    }
  }
  const sorted = Object.fromEntries(
    Object.entries(dates).sort(([a], [b]) => a.localeCompare(b))
  );
  if (hasTbc) sorted.TBC = '';
  return sorted;
}

function formatAddress4(value) {
  const slug = trim(value);
  const map = {
    '1-stop-instruction-ilford': 'Ilford (Fairlop Powerleague)',
    '1-stop-instruction-beckton': 'Beckton (Newham Powerleague)',
    '1-stop-instruction-barnet': 'Barnet',
    '1-stop-instruction-tottenham': 'Tottenham (Frederick Knight Sports Ground)',
  };
  return map[slug] || slug;
}

function buildLocationLines(event) {
  const lines = [];
  if (event.location_name) lines.push(event.location_name);
  if (event.address1) lines.push(event.address1);
  if (event.address2) lines.push(event.address2);
  if (event.address3) lines.push(event.address3);
  const a4 = formatAddress4(event.address4);
  if (a4) lines.push(a4);
  if (event.postcode) lines.push(event.postcode);
  return lines;
}

function buildDateEntries(dates) {
  return Object.entries(dates).map(([dateKey, timeRange], index) => ({
    day_number: index + 1,
    date_key: dateKey,
    date_label: dateKey === 'TBC' ? 'TBC' : formatLongDate(dateKey),
    time_label: formatTimeAmPm(timeRange),
    is_tbc: dateKey === 'TBC',
  }));
}

async function loadConfirmationEventSummary(pool, eventId) {
  const id = Number(eventId);
  if (!id) return null;

  const [eventRows] = await pool.query(
    `SELECT course_events.id,
            courses.course_name,
            locations.location_name,
            locations.address1,
            locations.address2,
            locations.address3,
            locations.address4,
            locations.postcode
     FROM course_events
     LEFT JOIN courses ON courses.id = course_events.course_id
     LEFT JOIN locations ON locations.id = course_events.location_id
     WHERE course_events.id = ?
     LIMIT 1`,
    [id]
  );
  const event = eventRows?.[0];
  if (!event) return null;

  const [dateRows] = await pool.query(
    `SELECT event_date, event_start_time, event_end_time
     FROM course_event_dates
     WHERE course_event_id = ?
     ORDER BY event_date ASC`,
    [id]
  );
  const dates = buildEventDatesMap(dateRows);
  const date_entries = buildDateEntries(dates);
  const confirmedDays = date_entries.filter((d) => !d.is_tbc).length;

  return {
    course_name: event.course_name || '',
    location_lines: buildLocationLines(event),
    date_entries,
    is_multi_day: confirmedDays > 1,
  };
}

module.exports = {
  loadConfirmationEventSummary,
};
