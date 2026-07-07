const { phpUnserialize } = require('../../utils/phpSerialize');
const { buildEventDates, timeAmPm } = require('./bookingDetailsService');

const RECORDS_PER_PAGE = 10;

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function parseArchiveData(raw) {
  if (raw == null) return null;
  const str = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
  if (!str) return null;
  return phpUnserialize(str);
}

function formatDateDDMMYYYY(dateValue) {
  if (!dateValue || dateValue === '0000-00-00') return '';
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatDateLongWithTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'long' });
  const month = d.toLocaleDateString('en-GB', { month: 'long' });
  const day = d.getDate();
  const suffix =
    day > 3 && day < 21
      ? 'th'
      : ['th', 'st', 'nd', 'rd'][day % 10 > 3 ? 0 : day % 10] || 'th';
  const time = d.toLocaleTimeString('en-GB', { hour12: false });
  return `${weekday} ${day}${suffix} ${month} ${d.getFullYear()} ${time}`;
}

function formatHistoryDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('en-GB');
  const time = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${date} @ ${time}`;
}

function currencyFormatted(amt) {
  const value = Number(amt);
  const safe = Number.isFinite(value) ? value : 0;
  return `£${safe.toFixed(2)}`;
}

function typeofBookingLabels() {
  return {
    m: 'Moto',
    o: 'Online',
    t: 'Terminal',
    w: 'Worldpay',
    r: 'RideTo',
  };
}

function vTypeSelectLabels() {
  return {
    '0': 'Manual',
    '1': 'Automatic',
    '3': 'I will be using my own vehicle',
  };
}

function formatAddress4Slug(slug) {
  const map = {
    '1-stop-instruction-ilford': 'Ilford (Fairlop Powerleague)',
    '1-stop-instruction-beckton': 'Beckton (Newham Powerleague)',
    '1-stop-instruction-barnet': 'Barnet',
    '1-stop-instruction-tottenham': 'Tottenham (Frederick Knight Sports Ground)',
  };
  return map[slug] || slug;
}

function buildLocationLines(location) {
  const address4 = location.address4
    ? formatAddress4Slug(location.address4)
    : '';
  return [
    location.location_name,
    location.address1,
    location.address2,
    location.address3,
    address4,
    location.postcode,
  ].filter(Boolean);
}

function mapEventDatesForResponse(dates) {
  const entries = [];
  let day = 1;
  const keys = Object.keys(dates || {});
  for (const key of keys) {
    if (key === 'TBC') {
      entries.push({ day, label: `Day ${day} - TBC`, dateKey: 'TBC', time: '' });
    } else {
      const multi = keys.filter((k) => k !== 'TBC').length > 1;
      entries.push({
        day,
        dateKey: key,
        label: multi
          ? `Day ${day} - ${new Date(`${key}T12:00:00`).toLocaleDateString('en-GB', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })} (${timeAmPm(dates[key])})`
          : `${new Date(`${key}T12:00:00`).toLocaleDateString('en-GB', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })} (${timeAmPm(dates[key])})`,
        time: timeAmPm(dates[key]),
      });
    }
    day += 1;
  }
  return entries;
}

async function resolveCourseInfoFromSnapshot(pool, booking, courseInfo) {
  let courseAbb = trim(courseInfo?.course_abb);
  let locationName = trim(courseInfo?.location);
  let eventDate = courseInfo?.event_date ? String(courseInfo.event_date).slice(0, 10) : '';

  if (!courseAbb && booking?.course_id) {
    const [rows] = await pool.query('SELECT course_abb FROM courses WHERE id = ? LIMIT 1', [
      booking.course_id,
    ]);
    courseAbb = trim(rows[0]?.course_abb);
  }

  if ((!locationName || !eventDate) && booking?.course_event_id) {
    const [eventRows] = await pool.query(
      'SELECT location_id FROM course_events WHERE id = ? LIMIT 1',
      [booking.course_event_id]
    );
    if (eventRows[0] && !locationName) {
      const [locationRows] = await pool.query(
        'SELECT location_name FROM locations WHERE id = ? LIMIT 1',
        [eventRows[0].location_id]
      );
      locationName = trim(locationRows[0]?.location_name);
    }
    if (!eventDate) {
      const [dateRows] = await pool.query(
        'SELECT event_date FROM course_event_dates WHERE course_event_id = ? LIMIT 1',
        [booking.course_event_id]
      );
      if (dateRows[0]?.event_date) {
        eventDate = String(dateRows[0].event_date).slice(0, 10);
      }
    }
  }

  return { courseAbb, locationName, eventDate };
}

async function getItineraryResult(pool, bookingId) {
  const [rows] = await pool.query(
    `SELECT student_daily_report.*, itinary_result_options.option
     FROM student_daily_report
     JOIN itinary_result_options ON itinary_result_options.id = student_daily_report.report
     WHERE student_daily_report.booking_id = ?
     LIMIT 1`,
    [Number(bookingId)]
  );
  const row = rows[0];
  if (!row) {
    return null;
  }

  let updatedByName = '';
  if (Number(row.updated_by) === 0) {
    const [adminRows] = await pool.query(
      `SELECT CONCAT(admin_fristname, ' ', admin_lastname) AS admin_name
       FROM admin WHERE admin_id = ? LIMIT 1`,
      [row.updated_by_id]
    );
    updatedByName = adminRows[0]?.admin_name || '';
  } else {
    const [insRows] = await pool.query(
      `SELECT CONCAT(fname, ' ', lname) AS ins_name FROM itineraries WHERE id = ? LIMIT 1`,
      [row.updated_by]
    );
    updatedByName = insRows[0]?.ins_name || '';
  }

  return {
    option: row.option,
    result_description: row.result_description || '',
    updated_by_name: updatedByName,
  };
}

async function getUpdateHistory(pool, bookingId) {
  const [rows] = await pool.query(
    `SELECT booking_update_history.*,
      CONCAT(admin.admin_fristname, ' ', admin.admin_lastname) AS admin_name
     FROM booking_update_history
     LEFT JOIN admin ON admin.admin_id = booking_update_history.updated_by_admin_id
     WHERE booking_update_history.booking_id = ?
     ORDER BY booking_update_history.created DESC`,
    [Number(bookingId)]
  );
  return (rows || []).map((row) => ({
    status: row.status,
    type: row.type,
    admin_name: row.admin_name || '',
    created: row.created,
    label: `${row.status} by ${row.admin_name || ''} on ${formatHistoryDate(row.created)}`,
  }));
}

async function getBookingMadeByLabel(pool, booking) {
  if (booking.type_of_book === 'r') {
    return 'Customer on RideTo Site';
  }
  if (booking.type_of_book !== 'o') {
    const [rows] = await pool.query(
      `SELECT CONCAT(admin_fristname, ' ', admin_lastname) AS admin_name
       FROM admin WHERE admin_id = ? LIMIT 1`,
      [booking.booking_made_by_id]
    );
    return rows[0]?.admin_name || '';
  }
  return 'Customer Online';
}

async function getLicenceTypes(pool) {
  const [rows] = await pool.query(
    'SELECT id, licence_type FROM driving_licence_types ORDER BY id ASC'
  );
  return rows || [];
}

async function getResultLabels(pool, bookingIds) {
  if (!bookingIds.length) {
    return {};
  }
  const [rows] = await pool.query(
    `SELECT student_daily_report.booking_id, itinary_result_options.option
     FROM student_daily_report
     JOIN itinary_result_options ON itinary_result_options.id = student_daily_report.report
     WHERE student_daily_report.booking_id IN (?)`,
    [bookingIds]
  );
  const map = {};
  for (const row of rows || []) {
    map[Number(row.booking_id)] = row.option;
  }
  return map;
}

function buildListWhere(nameScr) {
  const term = trim(nameScr);
  if (!term) {
    return { where: '', params: [] };
  }
  return {
    where: ' WHERE booking_data LIKE ? ',
    params: [`%${term}%`],
  };
}

async function listDeletedBookings(pool, query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const { where, params } = buildListWhere(query.name_scr);
  const offset = (page - 1) * RECORDS_PER_PAGE;

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM deleted_bookings${where}`,
    params
  );
  const total = Number(countRows[0]?.total) || 0;

  const [rows] = await pool.query(
    `SELECT * FROM deleted_bookings${where} ORDER BY created DESC LIMIT ? OFFSET ?`,
    [...params, RECORDS_PER_PAGE, offset]
  );

  const items = [];
  const bookingIds = [];

  for (const row of rows || []) {
    const archive = parseArchiveData(row.booking_data);
    if (!archive?.booking || !archive?.attendee) {
      continue;
    }

    const bk = archive.booking;
    const at = archive.attendee;

    if (!(at.id != null && String(at.id) !== '' && bk.id != null && String(bk.id) !== '')) {
      continue;
    }

    const bookingId = Number(bk.id);
    bookingIds.push(bookingId);

    const courseInfo = await resolveCourseInfoFromSnapshot(
      pool,
      bk,
      archive.course_info || {}
    );

    items.push({
      attendee_id: Number(at.id),
      booking_id: bookingId,
      booking_ref: trim(at.booking_ref),
      first_name: trim(at.first_name),
      sur_name: trim(at.sur_name),
      course_abb: courseInfo.courseAbb,
      location_name: courseInfo.locationName,
      event_date: courseInfo.eventDate,
      license_number: trim(at.license_number),
      email: trim(at.email),
      contact1: trim(at.contact1),
      contact2: trim(at.contact2),
      contact3: trim(at.contact3),
      result: 'Not yet submitted',
    });
  }

  const resultMap = await getResultLabels(pool, bookingIds);
  for (const item of items) {
    if (resultMap[item.booking_id]) {
      item.result = resultMap[item.booking_id];
    }
  }

  return {
    items,
    pagination: {
      page,
      perPage: RECORDS_PER_PAGE,
      total,
      totalPages: Math.max(1, Math.ceil(total / RECORDS_PER_PAGE)),
    },
  };
}

async function deletedBookingExists(pool, bookingId) {
  const [rows] = await pool.query(
    'SELECT booking_id FROM deleted_bookings WHERE booking_id = ? LIMIT 1',
    [Number(bookingId)]
  );
  return Boolean(rows?.length);
}

async function purgeDeletedBooking(pool, bookingId) {
  const id = Number(bookingId);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, message: 'Booking not found to delete' };
  }

  const exists = await deletedBookingExists(pool, id);
  if (!exists) {
    return { ok: false, message: 'Booking not found to delete' };
  }

  await pool.query('DELETE FROM booking_payments WHERE booking_id = ?', [id]);
  await pool.query('DELETE FROM student_daily_report WHERE booking_id = ?', [id]);
  const [result] = await pool.query('DELETE FROM deleted_bookings WHERE booking_id = ?', [id]);

  if (result.affectedRows > 0) {
    return { ok: true, message: 'Booking deleted successfully' };
  }

  return { ok: false, message: 'Error in deleting booking' };
}

async function getDeletedBookingView(pool, bookingId) {
  const id = Number(bookingId);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, message: 'Booking/Gift Voucher not found to view' };
  }

  const [rows] = await pool.query(
    'SELECT * FROM deleted_bookings WHERE booking_id = ? LIMIT 1',
    [id]
  );
  const row = rows[0];
  if (!row) {
    return { ok: false, message: 'Booking/Gift Voucher not found to view' };
  }

  const archive = parseArchiveData(row.booking_data);
  if (!archive?.booking || !archive?.attendee) {
    return { ok: false, message: 'Booking/Gift Voucher not found to view' };
  }

  const booking = archive.booking;
  const attendee = archive.attendee;

  const [courseRows] = await pool.query(
    'SELECT course_abb, course_name FROM courses WHERE id = ? LIMIT 1',
    [booking.course_id]
  );
  const [eventRows] = await pool.query(
    'SELECT location_id, franchise_id FROM course_events WHERE id = ? LIMIT 1',
    [booking.course_event_id]
  );

  let locationLines = [];
  let franchiseName = '';
  let locAbb = '';

  if (eventRows[0]) {
    const [locationRows] = await pool.query(
      `SELECT location_name, loc_abb, address1, address2, address3, address4, postcode
       FROM locations WHERE id = ? LIMIT 1`,
      [eventRows[0].location_id]
    );
    if (locationRows[0]) {
      locationLines = buildLocationLines(locationRows[0]);
      locAbb = trim(locationRows[0].loc_abb);
    }

    const [franchiseRows] = await pool.query(
      'SELECT franchise_name FROM franchise WHERE id = ? LIMIT 1',
      [eventRows[0].franchise_id]
    );
    franchiseName = trim(franchiseRows[0]?.franchise_name);
  }

  const [dateRows] = await pool.query(
    'SELECT * FROM course_event_dates WHERE course_event_id = ? ORDER BY event_date ASC',
    [booking.course_event_id]
  );
  const eventDates = buildEventDates(dateRows);
  const dateKeys = Object.keys(eventDates).filter((k) => k !== 'TBC').sort();
  const courseSumm = dateKeys[0] || '';

  const typeLabels = typeofBookingLabels();
  const promo =
    Number(booking.is_promo_applied) === 1 && Number(booking.promo_code_id) > 0
      ? (
          await pool.query('SELECT * FROM promos WHERE id = ? LIMIT 1', [
            booking.promo_code_id,
          ])
        )[0][0]
      : null;

  const licenceTypes = await getLicenceTypes(pool);
  const licenceLabel =
    licenceTypes.find((lt) => Number(lt.id) === Number(attendee.license_type))
      ?.licence_type || '';

  const itinerary = await getItineraryResult(pool, id);
  const courseName =
    trim(courseRows[0]?.course_name) || trim(courseRows[0]?.course_abb) || '';

  return {
    ok: true,
    data: {
      is_deleted: true,
      booking_id: Number(booking.id),
      course_event_id: Number(booking.course_event_id),
      booking_ref: trim(attendee.booking_ref),
      course_name: courseName,
      event_dates: mapEventDatesForResponse(eventDates),
      location_lines: locationLines,
      franchise_name: franchiseName,
      total_fees: Number(booking.total_fees),
      total_fees_formatted: currencyFormatted(booking.total_fees),
      payment_received:
        Number(booking.total_amount) - Number(booking.payment_due),
      payment_received_formatted: currencyFormatted(
        Number(booking.total_amount) - Number(booking.payment_due)
      ),
      payment_due: Number(booking.payment_due),
      payment_due_formatted: currencyFormatted(booking.payment_due),
      promo: promo
        ? {
            promo_code: promo.promo_code,
            promo_description: promo.promo_description,
          }
        : null,
      booking_created: formatDateLongWithTime(booking.created),
      type_of_book: booking.type_of_book,
      type_of_book_label: typeLabels[booking.type_of_book] || booking.type_of_book,
      booking_made_by: await getBookingMadeByLabel(pool, booking),
      update_history: await getUpdateHistory(pool, Number(booking.id)),
      itinerary: itinerary || {
        option: 'Not yet submitted',
        result_description: '',
        updated_by_name: '',
      },
      attendee: {
        first_name: trim(attendee.first_name),
        sur_name: trim(attendee.sur_name),
        full_name: `${trim(attendee.first_name)} ${trim(attendee.sur_name)}`.trim(),
        contact1: trim(attendee.contact1),
        contact2: trim(attendee.contact2),
        contact3: trim(attendee.contact3),
        date_of_birth: formatDateDDMMYYYY(attendee.date_of_birth),
        email: trim(attendee.email),
        vehicle_type: String(attendee.vehicle_type),
        vehicle_type_label:
          vTypeSelectLabels()[String(attendee.vehicle_type)] || '',
        license_type: attendee.license_type,
        license_type_label: licenceLabel,
        license_number: trim(attendee.license_number),
        theory_number: trim(attendee.theory_number),
        admin_notes: trim(attendee.admin_notes),
        notes: trim(attendee.notes),
      },
      booking_summary: `${trim(courseRows[0]?.course_abb) || ''} ${locAbb} ${formatDateDDMMYYYY(courseSumm)} - ${currencyFormatted(Number(booking.total_amount) - Number(booking.payment_due))} ${typeLabels[booking.type_of_book] || ''} on ${formatDateDDMMYYYY(booking.created)}`,
      matched_prior_count: 0,
      status: Number(booking.status),
      refundable: Number(booking.refundable),
    },
  };
}

module.exports = {
  listDeletedBookings,
  purgeDeletedBooking,
  getDeletedBookingView,
};
