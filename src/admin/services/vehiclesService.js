/**
 * Admin fleet — port of vehicles/*.php and vehicles.class.php
 */
const RECORDS_PER_PAGE = 10;

const SETTING_TYPES = [
  'make_model',
  'engine_size',
  'transmission',
  'log_events',
  'log_issues',
];

const SETTING_TYPE_LABELS = {
  make_model: 'Make / Model',
  engine_size: 'Engine Size',
  transmission: 'Transmission',
  log_events: 'Log Events',
  log_issues: 'Log Issues',
};

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function nowMysql() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function toDateOrEmpty(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime()) || value.getFullYear() < 1900) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
  }
  const raw = trim(value);
  if (!raw || raw.startsWith('0000-00-00')) return '';
  const uk = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (uk) {
    return `${uk[3]}-${uk[2].padStart(2, '0')}-${uk[1].padStart(2, '0')}`;
  }
  return raw.slice(0, 10);
}

function as01(value, defaultValue = 1) {
  if (value === true || value === '1' || value === 1) return 1;
  if (value === false || value === '0' || value === 0) return 0;
  if (value == null || value === '') return defaultValue;
  return Number(value) ? 1 : 0;
}

function paginationMeta(page, perPage, total) {
  const pageNum = Math.max(1, Number(page) || 1);
  return {
    page: pageNum,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage) || 1),
  };
}

function colorFromExpiry(dateValue, now = new Date()) {
  const raw = toDateOrEmpty(dateValue);
  if (!raw) return 'green';
  const expiry = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(expiry.getTime())) return 'green';
  if (now >= expiry) return 'red';
  const warn = new Date(expiry);
  warn.setDate(warn.getDate() - 30);
  if (now > warn && now < expiry) return 'yellow';
  return 'green';
}

function computeColors(row, { mode } = {}) {
  const now = new Date();
  let issue_color = mode === 'add' ? 'green' : row.issue_color || 'green';

  const mot_color = colorFromExpiry(row.mot_expiry_date, now);

  let road_tax_color = 'green';
  const sorn = trim(row.sorn_exempt_option) || 'road_tax';
  if (sorn === 'sorn') {
    road_tax_color = 'blue';
  } else if (sorn === 'exempt') {
    road_tax_color = 'green';
  } else if (sorn === 'road_tax' && toDateOrEmpty(row.road_tax_due_date)) {
    road_tax_color = colorFromExpiry(row.road_tax_due_date, now);
  }

  let service_color = 'green';
  const mileage = Number(row.mileage) || 0;
  const lastServiceMileage = Number(row.mileage_last_service) || 0;
  const interval = Number(row.mileage_service_interval) || 0;
  let mileageDiff = lastServiceMileage - mileage;
  if (mileageDiff < 0) mileageDiff *= -1;
  if (interval > 0 && mileageDiff >= interval) {
    service_color = 'red';
  } else {
    const lastService = toDateOrEmpty(row.last_service_date);
    if (lastService) {
      const plusYear = new Date(`${lastService}T00:00:00`);
      plusYear.setFullYear(plusYear.getFullYear() + 1);
      if (now > plusYear) service_color = 'yellow';
    }
  }

  return { issue_color, mot_color, road_tax_color, service_color };
}

async function applyVehicleColors(pool, id, mode) {
  const [rows] = await pool.query('SELECT * FROM vehicles WHERE id = ? LIMIT 1', [
    id,
  ]);
  const row = rows?.[0];
  if (!row) return;
  const colors = computeColors(row, { mode });
  await pool.query(
    `UPDATE vehicles
     SET issue_color = ?, mot_color = ?, road_tax_color = ?, service_color = ?
     WHERE id = ?`,
    [
      colors.issue_color,
      colors.mot_color,
      colors.road_tax_color,
      colors.service_color,
      id,
    ]
  );
}

async function updateVehicleIssueStatus(pool, vid) {
  const [rows] = await pool.query(
    `SELECT issue_status, COUNT(issue_status) AS cnt
     FROM vehicle_logs WHERE vehicle_id = ? GROUP BY issue_status`,
    [vid]
  );
  let status = 'green';
  const colors = (rows || []).map((r) => String(r.issue_status || ''));
  if (colors.includes('red')) status = 'red';
  else if (colors.includes('purple')) status = 'purple';
  else if (colors.includes('yellow')) status = 'yellow';
  await pool.query('UPDATE vehicles SET issue_color = ? WHERE id = ?', [
    status,
    vid,
  ]);
}

const VEHICLE_LIST_JOINS = `
  FROM vehicles
  LEFT JOIN vehicle_fleet_settings AS mm
    ON mm.setting_type = 'make_model' AND mm.setting_name = 'option_name' AND mm.id = vehicles.make_model_id
  LEFT JOIN vehicle_fleet_settings AS en
    ON en.setting_type = 'engine_size' AND en.setting_name = 'option_name' AND en.id = vehicles.engine_size_id
  LEFT JOIN vehicle_fleet_settings AS tran
    ON tran.setting_type = 'transmission' AND tran.setting_name = 'option_name' AND tran.id = vehicles.transmission_id
  LEFT JOIN locations AS loc ON loc.id = vehicles.location_id
`;

function mapListRow(row) {
  return {
    id: Number(row.id),
    registration: row.registration || '',
    make_model: row.make_model || '',
    engine_size: row.engine_size != null ? String(row.engine_size) : '',
    transmission: row.transmission || '',
    location_name: row.location_name || '',
    loc_abb: row.loc_abb || '',
    location_id: Number(row.location_id) || 0,
    include_into_alert: Number(row.include_into_alert) || 0,
    mileage: Number(row.mileage) || 0,
    mileage_updated_at: row.mileage_updated_at,
    issue_color: row.issue_color || 'green',
    mot_color: row.mot_color || 'none',
    road_tax_color: row.road_tax_color || 'none',
    service_color: row.service_color || 'none',
    mot_expiry_date: toDateOrEmpty(row.mot_expiry_date),
    road_tax_due_date: toDateOrEmpty(row.road_tax_due_date),
    last_service_date: toDateOrEmpty(row.last_service_date),
    make_model_id: Number(row.make_model_id) || 0,
    engine_size_id: Number(row.engine_size_id) || 0,
    transmission_id: Number(row.transmission_id) || 0,
  };
}

async function getVehicleFormOptions(pool) {
  const load = async (type) => {
    const [rows] = await pool.query(
      `SELECT id, setting_value FROM vehicle_fleet_settings
       WHERE setting_type = ? AND setting_name = 'option_name' AND status = 1
       ORDER BY order_no ASC`,
      [type]
    );
    return (rows || []).map((r) => ({
      id: Number(r.id),
      label: type === 'engine_size' ? `${r.setting_value}cc` : r.setting_value,
      value: r.setting_value,
    }));
  };
  const [make_model, engine_size, transmission, locations, log_events, log_issues] =
    await Promise.all([
      load('make_model'),
      load('engine_size'),
      load('transmission'),
      pool
        .query(
          `SELECT id, location_name, loc_abb FROM locations
           WHERE show_in_vehicle_schedule = 1 AND status = '1'
           ORDER BY loc_abb ASC`
        )
        .then(([rows]) =>
          (rows || []).map((r) => ({
            id: Number(r.id),
            label: r.loc_abb || r.location_name,
            location_name: r.location_name,
          }))
        ),
      load('log_events'),
      load('log_issues'),
    ]);
  return {
    make_model,
    engine_size,
    transmission,
    locations,
    log_events,
    log_issues,
  };
}

async function listVehicles(pool, { page = 1, searchterm = {} } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const nameScr = trim(searchterm.name_scr);
  let where = '';
  const params = [];
  if (nameScr) {
    where = ` WHERE vehicles.registration LIKE ?
      OR loc.loc_abb LIKE ?
      OR mm.setting_value LIKE ?
      OR en.setting_value LIKE ?
      OR tran.setting_value LIKE ? `;
    const like = `%${nameScr}%`;
    params.push(like, like, like, like, like);
  }

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total ${VEHICLE_LIST_JOINS} ${where}`,
    params
  );
  const total = Number(countRows?.[0]?.total) || 0;
  const offset = (pageNum - 1) * RECORDS_PER_PAGE;

  const [rows] = await pool.query(
    `SELECT vehicles.id, vehicles.registration, vehicles.include_into_alert,
            vehicles.location_id,
            mm.setting_value AS make_model,
            (en.setting_value * 1) AS engine_size,
            tran.setting_value AS transmission,
            loc.location_name, loc.loc_abb
     ${VEHICLE_LIST_JOINS}
     ${where}
     ORDER BY engine_size ASC, mm.setting_value ASC, tran.setting_value ASC, vehicles.registration ASC
     LIMIT ?, ?`,
    [...params, offset, RECORDS_PER_PAGE]
  );

  return {
    items: (rows || []).map(mapListRow),
    pagination: paginationMeta(pageNum, RECORDS_PER_PAGE, total),
    filters: { name_scr: nameScr },
  };
}

async function searchVehicles(pool, q) {
  const nameScr = trim(q);
  if (!nameScr) return { items: [] };
  const like = `%${nameScr}%`;
  const [rows] = await pool.query(
    `SELECT vehicles.id, vehicles.registration,
            mm.setting_value AS make_model,
            loc.loc_abb
     ${VEHICLE_LIST_JOINS}
     WHERE vehicles.registration LIKE ?
        OR loc.loc_abb LIKE ?
        OR mm.setting_value LIKE ?
     ORDER BY vehicles.registration ASC
     LIMIT 20`,
    [like, like, like]
  );
  return { items: (rows || []).map(mapListRow) };
}

function scheduleWhere({ loc_scr, name_scr }) {
  const params = [];
  let where =
    ' WHERE location_id IN (SELECT id FROM locations WHERE show_in_vehicle_schedule = 1 AND status = \'1\') ';
  const locId = Number(loc_scr) || 0;
  if (locId > 0) {
    where = ' WHERE location_id = ? ';
    params.push(locId);
  }
  const nameScr = trim(name_scr);
  if (nameScr) {
    where += ` AND (vehicles.registration LIKE ?
      OR mm.setting_value LIKE ?
      OR en.setting_value LIKE ?
      OR tran.setting_value LIKE ?) `;
    const like = `%${nameScr}%`;
    params.push(like, like, like, like);
  }
  return { where, params };
}

function nestSchedule(rows) {
  const locations = [];
  const locMap = new Map();
  for (const row of rows || []) {
    if (!row.transmission_id || !row.make_model_id || !row.engine_size_id) {
      continue;
    }
    const locId = Number(row.location_id);
    if (!locMap.has(locId)) {
      const loc = {
        location_id: locId,
        location_name: row.loc_abb || row.location_name,
        transmissions: [],
      };
      loc._t = new Map();
      locMap.set(locId, loc);
      locations.push(loc);
    }
    const loc = locMap.get(locId);
    const tId = Number(row.transmission_id);
    if (!loc._t.has(tId)) {
      const t = {
        transmission_id: tId,
        transmission_name: row.transmission,
        make_models: [],
      };
      t._m = new Map();
      loc._t.set(tId, t);
      loc.transmissions.push(t);
    }
    const t = loc._t.get(tId);
    const mId = Number(row.make_model_id);
    if (!t._m.has(mId)) {
      const m = {
        make_model_id: mId,
        make_model: row.make_model,
        engines: [],
      };
      t._m.set(mId, m);
      t.make_models.push(m);
    }
    t._m.get(mId).engines.push(mapListRow(row));
  }
  for (const loc of locations) {
    delete loc._t;
    for (const t of loc.transmissions) {
      delete t._m;
    }
  }
  return locations;
}

async function getVehicleSchedule(pool, searchterm = {}) {
  const { where, params } = scheduleWhere(searchterm);
  const [rows] = await pool.query(
    `SELECT vehicles.*, mm.setting_value AS make_model,
            (en.setting_value * 1) AS engine_size,
            tran.setting_value AS transmission,
            loc.location_name, loc.loc_abb
     ${VEHICLE_LIST_JOINS}
     ${where}
     ORDER BY loc.loc_abb ASC, transmission ASC, make_model ASC, engine_size ASC, vehicles.registration ASC`,
    params
  );
  const [locs] = await pool.query(
    `SELECT id, loc_abb FROM locations
     WHERE show_in_vehicle_schedule = 1 AND status = '1'
     ORDER BY loc_abb ASC`
  );
  return {
    locations: nestSchedule(rows),
    locationOptions: (locs || []).map((l) => ({
      id: Number(l.id),
      label: l.loc_abb,
    })),
    filters: {
      loc_scr: trim(searchterm.loc_scr) || '0',
      name_scr: trim(searchterm.name_scr),
    },
  };
}

async function getMileageGrid(pool, searchterm = {}) {
  const { where, params } = scheduleWhere(searchterm);
  const [rows] = await pool.query(
    `SELECT vehicles.id, vehicles.location_id, vehicles.make_model_id,
            vehicles.engine_size_id, vehicles.transmission_id,
            vehicles.registration, vehicles.mileage, vehicles.mileage_updated_at,
            mm.setting_value AS make_model,
            (en.setting_value * 1) AS engine_size,
            tran.setting_value AS transmission,
            loc.location_name, loc.loc_abb
     ${VEHICLE_LIST_JOINS}
     ${where}
     ORDER BY loc.loc_abb ASC, transmission ASC, make_model ASC, engine_size ASC, vehicles.registration ASC`,
    params
  );
  const [locs] = await pool.query(
    `SELECT id, loc_abb FROM locations
     WHERE show_in_vehicle_schedule = 1 AND status = '1'
     ORDER BY loc_abb ASC`
  );
  return {
    locations: nestSchedule(rows),
    locationOptions: (locs || []).map((l) => ({
      id: Number(l.id),
      label: l.loc_abb,
    })),
    filters: {
      loc_scr: trim(searchterm.loc_scr) || '0',
      name_scr: trim(searchterm.name_scr),
    },
  };
}

async function bulkUpdateMileages(pool, body = {}) {
  const data = body.data && typeof body.data === 'object' ? body.data : {};
  const keys = Object.keys(data);
  if (!keys.length) {
    return { ok: false, message: 'No mileage data submitted' };
  }
  const now = nowMysql();
  for (const key of keys) {
    const parts = String(key).split('_');
    const id = Number(parts[parts.length - 1] || key);
    const payload = data[key];
    const mileage = Number(
      payload && typeof payload === 'object' ? payload.mileage : payload
    );
    if (!id || !Number.isFinite(mileage)) continue;
    const [rows] = await pool.query(
      'SELECT * FROM vehicles WHERE id = ? LIMIT 1',
      [id]
    );
    const existing = rows?.[0];
    if (!existing) continue;
    const colors = computeColors({ ...existing, mileage });
    if (Number(existing.mileage) !== mileage) {
      await pool.query(
        `UPDATE vehicles SET mileage = ?, service_color = ?, mileage_updated_at = ? WHERE id = ?`,
        [mileage, colors.service_color, now, id]
      );
    } else {
      await pool.query(
        `UPDATE vehicles SET mileage = ?, service_color = ? WHERE id = ?`,
        [mileage, colors.service_color, id]
      );
    }
  }
  return { ok: true, message: 'Vehicle Mileage updated successfully' };
}

function mapVehicleDetail(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    registration: row.registration || '',
    make_model_id: Number(row.make_model_id) || 0,
    engine_size_id: Number(row.engine_size_id) || 0,
    transmission_id: Number(row.transmission_id) || 0,
    location_id: Number(row.location_id) || 0,
    mileage: Number(row.mileage) || 0,
    last_service_date: toDateOrEmpty(row.last_service_date),
    mileage_last_service: Number(row.mileage_last_service) || 0,
    mileage_service_interval: Number(row.mileage_service_interval) || 0,
    sorn_exempt_option: row.sorn_exempt_option || 'road_tax',
    road_tax_due_date: toDateOrEmpty(row.road_tax_due_date),
    mot_expiry_date: toDateOrEmpty(row.mot_expiry_date),
    include_into_alert: Number(row.include_into_alert),
    include_into_issue: Number(row.include_into_issue),
    include_into_mot: Number(row.include_into_mot),
    include_into_roadtax: Number(row.include_into_roadtax),
    include_into_service: Number(row.include_into_service),
    status: Number(row.status),
    issue_color: row.issue_color,
    mot_color: row.mot_color,
    road_tax_color: row.road_tax_color,
    service_color: row.service_color,
    mileage_updated_at: row.mileage_updated_at,
  };
}

async function getVehicleById(pool, id) {
  const vid = Number(id);
  if (!vid) return null;
  const [rows] = await pool.query('SELECT * FROM vehicles WHERE id = ? LIMIT 1', [
    vid,
  ]);
  return mapVehicleDetail(rows?.[0]);
}

function normalizeVehicleBody(body = {}) {
  const registration = trim(body.registration).replace(/\s+/g, '').toUpperCase();
  let sorn = trim(body.sorn_exempt_option || body.sorn_exempt) || 'road_tax';
  let roadTax = toDateOrEmpty(body.road_tax_due_date);
  if (sorn === 'sorn' || sorn === 'exempt') {
    roadTax = '';
  } else {
    sorn = 'road_tax';
  }
  return {
    registration,
    make_model_id: Number(body.make_model_id) || 0,
    engine_size_id: Number(body.engine_size_id) || 0,
    transmission_id: Number(body.transmission_id) || 0,
    location_id: Number(body.location_id) || 0,
    mileage: Number(body.mileage) || 0,
    last_service_date: toDateOrEmpty(body.last_service_date),
    mileage_last_service: Number(body.mileage_last_service) || 0,
    mileage_service_interval: Number(body.mileage_service_interval) || 0,
    sorn_exempt_option: sorn,
    road_tax_due_date: roadTax,
    mot_expiry_date: toDateOrEmpty(body.mot_expiry_date),
    include_into_alert: as01(body.include_into_alert, 1),
    include_into_issue: as01(body.include_into_issue, 1),
    include_into_mot: as01(body.include_into_mot, 1),
    include_into_roadtax: as01(body.include_into_roadtax, 1),
    include_into_service: as01(body.include_into_service, 1),
  };
}

function validateVehicle(fields) {
  if (!fields.registration) return { ok: false, message: 'Required fields can not be left blank' };
  if (!fields.make_model_id || !fields.engine_size_id || !fields.transmission_id) {
    return { ok: false, message: 'Required fields can not be left blank' };
  }
  if (!fields.location_id) return { ok: false, message: 'Please select Location' };
  if (!fields.last_service_date || !fields.mot_expiry_date) {
    return { ok: false, message: 'Required fields can not be left blank' };
  }
  return { ok: true };
}

async function createVehicle(pool, body) {
  const fields = normalizeVehicleBody(body);
  const validation = validateVehicle(fields);
  if (!validation.ok) return validation;
  const [dup] = await pool.query(
    'SELECT id FROM vehicles WHERE registration = ? LIMIT 1',
    [fields.registration]
  );
  if (dup?.length) {
    return { ok: false, message: 'Vehicle already exits with same registration' };
  }
  const created = nowMysql();
  const [result] = await pool.query(
    `INSERT INTO vehicles (
       registration, make_model_id, engine_size_id, transmission_id, location_id,
       mileage, last_service_date, mileage_last_service, mileage_service_interval,
       sorn_exempt_option, road_tax_due_date, mot_expiry_date,
       include_into_alert, include_into_issue, include_into_mot,
       include_into_roadtax, include_into_service, status, created_at, modified_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      fields.registration,
      fields.make_model_id,
      fields.engine_size_id,
      fields.transmission_id,
      fields.location_id,
      fields.mileage,
      fields.last_service_date,
      fields.mileage_last_service,
      fields.mileage_service_interval,
      fields.sorn_exempt_option,
      fields.road_tax_due_date,
      fields.mot_expiry_date,
      fields.include_into_alert,
      fields.include_into_issue,
      fields.include_into_mot,
      fields.include_into_roadtax,
      fields.include_into_service,
      created,
      created,
    ]
  );
  await applyVehicleColors(pool, result.insertId, 'add');
  return {
    ok: true,
    message: 'Vehicle added successfully',
    data: { id: result.insertId },
  };
}

async function updateVehicle(pool, id, body) {
  const vid = Number(id);
  const existing = await getVehicleById(pool, vid);
  if (!existing) return { ok: false, message: 'Vehicle not found to edit' };
  const fields = normalizeVehicleBody(body);
  const validation = validateVehicle(fields);
  if (!validation.ok) return validation;
  const [dup] = await pool.query(
    'SELECT id FROM vehicles WHERE registration = ? AND id != ? LIMIT 1',
    [fields.registration, vid]
  );
  if (dup?.length) {
    return { ok: false, message: 'Vehicle already exits with same registration' };
  }
  await pool.query(
    `UPDATE vehicles SET
       registration = ?, make_model_id = ?, engine_size_id = ?, transmission_id = ?,
       location_id = ?, mileage = ?, last_service_date = ?, mileage_last_service = ?,
       mileage_service_interval = ?, sorn_exempt_option = ?, road_tax_due_date = ?,
       mot_expiry_date = ?, include_into_alert = ?, include_into_issue = ?,
       include_into_mot = ?, include_into_roadtax = ?, include_into_service = ?,
       modified_at = ?
     WHERE id = ?`,
    [
      fields.registration,
      fields.make_model_id,
      fields.engine_size_id,
      fields.transmission_id,
      fields.location_id,
      fields.mileage,
      fields.last_service_date,
      fields.mileage_last_service,
      fields.mileage_service_interval,
      fields.sorn_exempt_option,
      fields.road_tax_due_date,
      fields.mot_expiry_date,
      fields.include_into_alert,
      fields.include_into_issue,
      fields.include_into_mot,
      fields.include_into_roadtax,
      fields.include_into_service,
      nowMysql(),
      vid,
    ]
  );
  await applyVehicleColors(pool, vid, 'edit');
  return { ok: true, message: 'Vehicle edited successfully' };
}

async function deleteVehicle(pool, id) {
  const vid = Number(id);
  const existing = await getVehicleById(pool, vid);
  if (!existing) return { ok: false, message: 'Location not found to delete' };
  await pool.query('DELETE FROM vehicle_logs WHERE vehicle_id = ?', [vid]);
  await pool.query('DELETE FROM vehicles WHERE id = ?', [vid]);
  return { ok: true, message: 'Vehicle deleted successfully' };
}

async function listVehicleLogs(pool, vehicleId, searchterm = {}) {
  const vid = Number(vehicleId);
  const vehicle = await getVehicleById(pool, vid);
  if (!vehicle) return { ok: false, message: 'Vehicle not found' };
  const params = [vid];
  let where = ' WHERE vehicle_logs.vehicle_id = ? ';
  if (trim(searchterm.issue_status)) {
    where += ' AND vehicle_logs.issue_status = ? ';
    params.push(trim(searchterm.issue_status));
  }
  if (trim(searchterm.log_event_id)) {
    where += ' AND vehicle_logs.log_event_id = ? ';
    params.push(Number(searchterm.log_event_id));
  }
  if (trim(searchterm.notes)) {
    where += ' AND (vehicle_logs.log_notes LIKE ? OR le.setting_value LIKE ?) ';
    const like = `%${trim(searchterm.notes)}%`;
    params.push(like, like);
  }
  const [rows] = await pool.query(
    `SELECT vehicle_logs.*, le.setting_value AS log_events, ins.fname, ins.lname
     FROM vehicle_logs
     LEFT JOIN vehicle_fleet_settings AS le
       ON le.setting_type = 'log_events' AND le.setting_name = 'option_name'
      AND le.id = vehicle_logs.log_event_id
     LEFT JOIN itineraries AS ins ON ins.id > 0 AND ins.id = vehicle_logs.updated_by
     ${where}
     ORDER BY log_date DESC`,
    params
  );
  const formOptions = await getVehicleFormOptions(pool);
  return {
    ok: true,
    data: {
      vehicle,
      items: (rows || []).map((r) => ({
        id: Number(r.id),
        vehicle_id: Number(r.vehicle_id),
        log_date: toDateOrEmpty(r.log_date),
        mileage: r.mileage,
        log_event_id: Number(r.log_event_id) || 0,
        log_events: r.log_events || '',
        log_notes: r.log_notes || '',
        issue_status: r.issue_status || '',
        updated_by_name: r.updated_by_name || '',
        created: r.created,
      })),
      formOptions,
      filters: {
        issue_status: trim(searchterm.issue_status),
        log_event_id: trim(searchterm.log_event_id),
        notes: trim(searchterm.notes),
      },
    },
  };
}

function adminName(session) {
  const first = trim(session?.admin_fristname || session?.loggedinAdmin?.admin_fristname);
  const last = trim(session?.admin_lastname || session?.loggedinAdmin?.admin_lastname);
  return `${first} ${last}`.trim() || 'Admin';
}

function adminId(session) {
  return (
    Number(session?.loggedinAdmin?.admin_id) ||
    Number(session?.loggedinAdmin?.id) ||
    0
  );
}

async function createVehicleLog(pool, vehicleId, body, session) {
  const vid = Number(vehicleId);
  const vehicle = await getVehicleById(pool, vid);
  if (!vehicle) return { ok: false, message: 'Vehicle not found' };
  const notes = trim(body.add_log_notes || body.log_notes);
  if (!notes) return { ok: false, message: 'Required fields can not be left blank' };
  const now = nowMysql();
  const [result] = await pool.query(
    `INSERT INTO vehicle_logs (
       vehicle_id, log_date, mileage, log_event_id, log_notes, issue_status,
       updated_by, updated_by_name, updated_by_id, created, updated
     ) VALUES (?, ?, ?, ?, ?, ?, -1, ?, ?, ?, ?)`,
    [
      vid,
      toDateOrEmpty(body.add_log_date || body.log_date) || now.slice(0, 10),
      Number(body.add_log_mileage ?? body.mileage) || vehicle.mileage,
      Number(body.log_event_id) || 0,
      notes,
      trim(body.log_issue_status || body.issue_status) || 'green',
      adminName(session),
      adminId(session),
      now,
      now,
    ]
  );
  await updateVehicleIssueStatus(pool, vid);
  return {
    ok: true,
    message: 'Vehicle Log added successfully',
    data: { id: result.insertId, location_id: vehicle.location_id },
  };
}

async function updateVehicleLog(pool, logId, body, session) {
  const lid = Number(logId);
  const [rows] = await pool.query(
    'SELECT * FROM vehicle_logs WHERE id = ? LIMIT 1',
    [lid]
  );
  const log = rows?.[0];
  if (!log) return { ok: false, message: 'Vehicle log not found' };
  const notes = trim(body.add_log_notes || body.log_notes);
  if (!notes) return { ok: false, message: 'Required fields can not be left blank' };
  await pool.query(
    `UPDATE vehicle_logs SET
       log_date = ?, mileage = ?, log_event_id = ?, log_notes = ?,
       issue_status = ?, updated_by = -1, updated_by_name = ?,
       updated_by_id = ?, updated = ?
     WHERE id = ?`,
    [
      toDateOrEmpty(body.add_log_date || body.log_date) || toDateOrEmpty(log.log_date),
      Number(body.add_log_mileage ?? body.mileage) || log.mileage,
      Number(body.log_event_id) || log.log_event_id,
      notes,
      trim(body.log_issue_status || body.issue_status) || log.issue_status,
      adminName(session),
      adminId(session),
      nowMysql(),
      lid,
    ]
  );
  await updateVehicleIssueStatus(pool, log.vehicle_id);
  const vehicle = await getVehicleById(pool, log.vehicle_id);
  return {
    ok: true,
    message: 'Vehicle Log updated successfully',
    data: { location_id: vehicle?.location_id || 0 },
  };
}

async function deleteVehicleLog(pool, vehicleId, logId) {
  const lid = Number(logId);
  const vid = Number(vehicleId);
  await pool.query('DELETE FROM vehicle_logs WHERE id = ? AND vehicle_id = ?', [
    lid,
    vid,
  ]);
  await updateVehicleIssueStatus(pool, vid);
  return { ok: true, message: 'Vehicle Log deleted successfully' };
}

async function updateLogMileage(pool, vehicleId, mileage) {
  const vid = Number(vehicleId);
  const [rows] = await pool.query('SELECT * FROM vehicles WHERE id = ? LIMIT 1', [
    vid,
  ]);
  const existing = rows?.[0];
  if (!existing) return { ok: false, message: 'Vehicle not found' };
  const mil = Number(mileage);
  const colors = computeColors({ ...existing, mileage: mil });
  await pool.query(
    `UPDATE vehicles SET mileage = ?, mileage_updated_at = ?, service_color = ? WHERE id = ?`,
    [mil, nowMysql(), colors.service_color, vid]
  );
  return { ok: true, message: 'Vehicle Mileage updated successfully' };
}

async function listStatusVehicles(pool, { type, color, loc_scr } = {}) {
  const kind = trim(type);
  if (!['issue', 'mot', 'road_tax', 'service'].includes(kind)) {
    return { ok: false, message: 'Invalid status type' };
  }
  const colorCol =
    kind === 'issue'
      ? 'issue_color'
      : kind === 'mot'
        ? 'mot_color'
        : kind === 'road_tax'
          ? 'road_tax_color'
          : 'service_color';
  const params = [];
  let where = ` WHERE vehicles.status = 1 `;
  if (kind === 'issue') {
    where += ` AND vehicles.issue_color != 'green' `;
  } else {
    where += ` AND vehicles.include_into_${kind === 'road_tax' ? 'roadtax' : kind} = 1 `;
  }
  if (trim(color)) {
    where += ` AND ${colorCol} = ? `;
    params.push(trim(color));
  }
  if (Number(loc_scr) > 0) {
    where += ' AND vehicles.location_id = ? ';
    params.push(Number(loc_scr));
  }
  const [rows] = await pool.query(
    `SELECT vehicles.id, vehicles.registration, vehicles.${colorCol} AS color,
            vehicles.mot_expiry_date, vehicles.road_tax_due_date, vehicles.last_service_date,
            loc.loc_abb
     FROM vehicles
     LEFT JOIN locations AS loc ON loc.id = vehicles.location_id
     ${where}
     ORDER BY FIELD(${colorCol}, 'red', 'yellow', 'purple', 'blue', 'green', 'none'), vehicles.registration ASC`,
    params
  );
  const titles = {
    issue: 'Reported Issues',
    mot: 'MOT Status',
    road_tax: 'Road Tax Status',
    service: 'Service Status',
  };
  return {
    ok: true,
    data: {
      type: kind,
      title: titles[kind],
      items: (rows || []).map((r) => ({
        id: Number(r.id),
        registration: r.registration,
        loc_abb: r.loc_abb || '',
        color: r.color,
        mot_expiry_date: toDateOrEmpty(r.mot_expiry_date),
        road_tax_due_date: toDateOrEmpty(r.road_tax_due_date),
        last_service_date: toDateOrEmpty(r.last_service_date),
      })),
    },
  };
}

async function listSettingTypes(pool) {
  const [rows] = await pool.query(
    `SELECT setting_type FROM vehicle_fleet_settings GROUP BY setting_type`
  );
  const types = (rows || []).map((r) => r.setting_type);
  const known = SETTING_TYPES.filter((t) => types.includes(t) || t === 'log_issues');
  const extra = types.filter((t) => !SETTING_TYPES.includes(t));
  return {
    types: [...known, ...extra].map((t) => ({
      type: t,
      label: SETTING_TYPE_LABELS[t] || t.replace(/_/g, ' '),
    })),
  };
}

async function listSettings(pool, type) {
  const settingType = trim(type);
  if (!settingType) return { ok: false, message: 'Error on settings' };
  const [rows] = await pool.query(
    `SELECT * FROM vehicle_fleet_settings
     WHERE setting_type = ? AND setting_name = 'option_name' AND status = 1
     ORDER BY order_no ASC`,
    [settingType]
  );
  return {
    ok: true,
    data: {
      type: settingType,
      label: SETTING_TYPE_LABELS[settingType] || settingType,
      items: (rows || []).map((r) => ({
        id: Number(r.id),
        setting_value: r.setting_value,
        order_no: Number(r.order_no) || 0,
      })),
    },
  };
}

async function createSetting(pool, body) {
  const type = trim(body.setting_type);
  const value = trim(body.setting_value);
  if (!type || !value) return { ok: false, message: 'Invalid Value' };
  const [dup] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM vehicle_fleet_settings
     WHERE setting_value = ? AND setting_type = ? AND status = 1`,
    [value, type]
  );
  if (Number(dup?.[0]?.cnt) > 0) {
    return { ok: false, message: 'This option value is already exists' };
  }
  const [maxRows] = await pool.query(
    `SELECT MAX(order_no) AS order_no FROM vehicle_fleet_settings WHERE setting_type = ?`,
    [type]
  );
  const orderNo = (Number(maxRows?.[0]?.order_no) || 0) + 1;
  const [result] = await pool.query(
    `INSERT INTO vehicle_fleet_settings (setting_type, setting_name, setting_value, order_no)
     VALUES (?, 'option_name', ?, ?)`,
    [type, value, orderNo]
  );
  return {
    ok: true,
    message: 'Option value is added successfully',
    data: { id: result.insertId },
  };
}

async function updateSetting(pool, id, body) {
  const sid = Number(id);
  const [rows] = await pool.query(
    'SELECT * FROM vehicle_fleet_settings WHERE id = ? LIMIT 1',
    [sid]
  );
  const existing = rows?.[0];
  if (!existing) return { ok: false, message: 'Option value not found to update' };
  const value = trim(body.setting_value);
  if (!value) return { ok: false, message: 'Invalid Value' };
  const [dup] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM vehicle_fleet_settings
     WHERE setting_value = ? AND setting_type = ? AND status = 1 AND id <> ?`,
    [value, existing.setting_type, sid]
  );
  if (Number(dup?.[0]?.cnt) > 0) {
    return { ok: false, message: 'This option value is already exists' };
  }
  await pool.query(
    'UPDATE vehicle_fleet_settings SET setting_value = ? WHERE id = ?',
    [value, sid]
  );
  return { ok: true, message: 'Option value is updated successfully' };
}

async function deleteSetting(pool, id) {
  const sid = Number(id);
  const [rows] = await pool.query(
    'SELECT * FROM vehicle_fleet_settings WHERE id = ? LIMIT 1',
    [sid]
  );
  if (!rows?.[0]) return { ok: false, message: 'Option value not found to delete' };
  await pool.query(
    'UPDATE vehicle_fleet_settings SET status = 0, order_no = 0 WHERE id = ?',
    [sid]
  );
  return { ok: true, message: 'Option Value is deleted successfully' };
}

async function reorderSetting(pool, id, direction) {
  const sid = Number(id);
  const [rows] = await pool.query(
    'SELECT * FROM vehicle_fleet_settings WHERE id = ? LIMIT 1',
    [sid]
  );
  const existing = rows?.[0];
  if (!existing) return { ok: false, message: 'Option value not found' };
  const type = existing.setting_type;
  const dir = trim(direction) === 'down' ? 'down' : 'up';
  const [neighborRows] = await pool.query(
    dir === 'up'
      ? `SELECT * FROM vehicle_fleet_settings
         WHERE setting_type = ? AND setting_name = 'option_name' AND status = 1
           AND order_no < ? ORDER BY order_no DESC LIMIT 1`
      : `SELECT * FROM vehicle_fleet_settings
         WHERE setting_type = ? AND setting_name = 'option_name' AND status = 1
           AND order_no > ? ORDER BY order_no ASC LIMIT 1`,
    [type, existing.order_no]
  );
  const neighbor = neighborRows?.[0];
  if (!neighbor) return { ok: true, message: 'Order has been successfully updated' };
  await pool.query('UPDATE vehicle_fleet_settings SET order_no = ? WHERE id = ?', [
    existing.order_no,
    neighbor.id,
  ]);
  await pool.query('UPDATE vehicle_fleet_settings SET order_no = ? WHERE id = ?', [
    neighbor.order_no,
    sid,
  ]);
  return { ok: true, message: 'Order has been successfully updated' };
}

module.exports = {
  listVehicles,
  searchVehicles,
  getVehicleSchedule,
  getMileageGrid,
  bulkUpdateMileages,
  getVehicleById,
  getVehicleFormOptions,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  listVehicleLogs,
  createVehicleLog,
  updateVehicleLog,
  deleteVehicleLog,
  updateLogMileage,
  listStatusVehicles,
  listSettingTypes,
  listSettings,
  createSetting,
  updateSetting,
  deleteSetting,
  reorderSetting,
  applyVehicleColors,
  RECORDS_PER_PAGE,
};
