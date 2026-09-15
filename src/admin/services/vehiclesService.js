/**
 * Admin fleet — port of vehicles/*.php and vehicles.class.php (vehicle-specific methods).
 */
const {
  nowMysql,
  computeServiceColor,
  setVehicleColors,
  updateVehicleIssueStatus,
} = require('./vehicleColorService');

const RECORDS_PER_PAGE = 10;

const VEHICLE_JOINS = `
  FROM vehicles
  LEFT JOIN vehicle_fleet_settings AS mm ON (
    mm.setting_type = 'make_model' AND mm.setting_name = 'option_name' AND mm.id = vehicles.make_model_id
  )
  LEFT JOIN vehicle_fleet_settings AS en ON (
    en.setting_type = 'engine_size' AND en.setting_name = 'option_name' AND en.id = vehicles.engine_size_id
  )
  LEFT JOIN vehicle_fleet_settings AS tran ON (
    tran.setting_type = 'transmission' AND tran.setting_name = 'option_name' AND tran.id = vehicles.transmission_id
  )
  LEFT JOIN locations AS loc ON loc.id = vehicles.location_id
`;

const VEHICLE_SELECT = `
  SELECT vehicles.*,
    mm.setting_value AS make_model,
    (en.setting_value * 1) AS engine_size,
    tran.setting_value AS transmission,
    loc.location_name,
    loc.loc_abb
`;

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function as01(value, defaultValue = 1) {
  if (value === true || value === '1' || value === 1) return 1;
  if (value === false || value === '0' || value === 0) return 0;
  if (value == null || value === '') return defaultValue;
  return Number(value) ? 1 : 0;
}

function toMysqlDate(value) {
  const raw = trim(value);
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function mapVehicleRow(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    make_model_id: Number(row.make_model_id) || 0,
    engine_size_id: Number(row.engine_size_id) || 0,
    transmission_id: Number(row.transmission_id) || 0,
    location_id: Number(row.location_id) || 0,
    mileage: Number(row.mileage) || 0,
    mileage_last_service: Number(row.mileage_last_service) || 0,
    mileage_service_interval: Number(row.mileage_service_interval) || 0,
    include_into_alert: Number(row.include_into_alert) || 0,
    include_into_issue: Number(row.include_into_issue) || 0,
    include_into_mot: Number(row.include_into_mot) || 0,
    include_into_roadtax: Number(row.include_into_roadtax) || 0,
    include_into_service: Number(row.include_into_service) || 0,
    status: Number(row.status) || 0,
    engine_size: row.engine_size != null ? Number(row.engine_size) : null,
  };
}

function buildScheduleGroups(rows) {
  const groups = {};
  for (const raw of rows) {
    const loc = mapVehicleRow(raw);
    if (!loc.transmission_id || !loc.make_model_id || !loc.engine_size_id) {
      continue;
    }
    const locKey = String(loc.location_id);
    if (!groups[locKey]) {
      groups[locKey] = {
        location_id: loc.location_id,
        location_name: loc.loc_abb || loc.location_name || '',
        transmission: {},
      };
    }
    const tKey = String(loc.transmission_id);
    if (!groups[locKey].transmission[tKey]) {
      groups[locKey].transmission[tKey] = {
        transmission_id: loc.transmission_id,
        transmission_name: loc.transmission || '',
        make_model: {},
      };
    }
    const mKey = String(loc.make_model_id);
    if (!groups[locKey].transmission[tKey].make_model[mKey]) {
      groups[locKey].transmission[tKey].make_model[mKey] = {
        make_model_id: loc.make_model_id,
        make_model: loc.make_model || '',
        engine: [],
      };
    }
    groups[locKey].transmission[tKey].make_model[mKey].engine.push(loc);
  }
  return Object.values(groups).map((g) => ({
    ...g,
    transmission: Object.values(g.transmission).map((t) => ({
      ...t,
      make_model: Object.values(t.make_model),
    })),
  }));
}

async function getScheduleLocationOptions(pool) {
  const [rows] = await pool.query(
    `SELECT id, loc_abb FROM locations WHERE show_in_vehicle_schedule = 1 AND status = '1' ORDER BY loc_abb ASC`
  );
  return rows.map((r) => ({
    id: Number(r.id),
    loc_abb: r.loc_abb || '',
  }));
}

function buildScheduleWhere(locationId, nameScr) {
  const params = [];
  let where = '';
  const locId = Number(locationId) || 0;
  if (locId > 0) {
    where += ' WHERE vehicles.location_id = ?';
    params.push(locId);
  } else {
    where +=
      " WHERE vehicles.location_id IN (SELECT id FROM locations WHERE show_in_vehicle_schedule = 1 AND status = '1')";
  }
  const term = trim(nameScr);
  if (term) {
    where +=
      ' AND (vehicles.registration LIKE ? OR mm.setting_value LIKE ? OR en.setting_value LIKE ? OR tran.setting_value LIKE ?)';
    const like = `%${term}%`;
    params.push(like, like, like, like);
  }
  return { where, params };
}

async function getVehicleSchedule(pool, query = {}) {
  const locationId = query.loc_scr ?? query.location_id ?? 0;
  const nameScr = query.name_scr ?? '';
  const { where, params } = buildScheduleWhere(locationId, nameScr);
  const order =
    ' ORDER BY loc.loc_abb ASC, transmission ASC, make_model ASC, engine_size ASC, vehicles.registration ASC';
  const [rows] = await pool.query(
    `${VEHICLE_SELECT} ${VEHICLE_JOINS} ${where} ${order}`,
    params
  );
  return {
    groups: buildScheduleGroups(rows),
    scheduleLocations: await getScheduleLocationOptions(pool),
    filters: {
      loc_scr: String(locationId || '0'),
      name_scr: trim(nameScr),
    },
  };
}

async function listVehicles(pool, query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const nameScr = trim(query.name_scr);
  const params = [];
  let where = '';
  if (nameScr) {
    where =
      ' WHERE vehicles.registration LIKE ? OR loc.loc_abb LIKE ? OR mm.setting_value LIKE ? OR en.setting_value LIKE ? OR tran.setting_value LIKE ?';
    const like = `%${nameScr}%`;
    params.push(like, like, like, like, like);
  }
  const order =
    ' ORDER BY engine_size ASC, mm.setting_value ASC, tran.setting_value ASC, vehicles.registration ASC';
  const offset = (page - 1) * RECORDS_PER_PAGE;
  const [items] = await pool.query(
    `${VEHICLE_SELECT}, vehicles.registration, vehicles.include_into_alert ${VEHICLE_JOINS} ${where} ${order} LIMIT ? OFFSET ?`,
    [...params, RECORDS_PER_PAGE, offset]
  );
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total ${VEHICLE_JOINS} ${where}`,
    params
  );
  const total = Number(countRows[0]?.total) || 0;
  return {
    items: items.map((r) => ({
      id: Number(r.id),
      registration: r.registration || '',
      make_model: r.make_model || '',
      engine_size: r.engine_size != null ? Number(r.engine_size) : null,
      transmission: r.transmission || '',
      location_name: r.location_name || '',
      loc_abb: r.loc_abb || '',
      location_id: Number(r.location_id) || 0,
      include_into_alert: Number(r.include_into_alert) || 0,
    })),
    pagination: {
      page,
      perPage: RECORDS_PER_PAGE,
      total,
      totalPages: Math.max(1, Math.ceil(total / RECORDS_PER_PAGE)),
    },
    filters: { name_scr: nameScr },
  };
}

async function loadFleetSettingOptions(pool, settingType) {
  const [rows] = await pool.query(
    `SELECT id, setting_value FROM vehicle_fleet_settings
     WHERE setting_type = ? AND setting_name = 'option_name' AND status = 1
     ORDER BY order_no ASC`,
    [settingType]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    label: r.setting_value || '',
    value: r.setting_value || '',
  }));
}

async function getVehicleFormOptions(pool) {
  const [locations] = await pool.query(
    `SELECT id, location_name FROM locations WHERE status = '1' ORDER BY location_name`
  );
  const [scheduleLocations] = await pool.query(
    `SELECT id, loc_abb FROM locations WHERE show_in_vehicle_schedule = 1 AND status = '1' ORDER BY loc_abb`
  );
  return {
    locations: locations.map((r) => ({
      id: Number(r.id),
      label: r.location_name || '',
    })),
    schedule_locations: scheduleLocations.map((r) => ({
      id: Number(r.id),
      label: r.loc_abb || '',
    })),
    make_model: await loadFleetSettingOptions(pool, 'make_model'),
    engine_size: await loadFleetSettingOptions(pool, 'engine_size'),
    transmission: await loadFleetSettingOptions(pool, 'transmission'),
    log_events: await loadFleetSettingOptions(pool, 'log_events'),
    log_issues: await loadFleetSettingOptions(pool, 'log_issues'),
  };
}

async function getVehicleById(pool, id) {
  const [rows] = await pool.query(
    `${VEHICLE_SELECT} ${VEHICLE_JOINS} WHERE vehicles.id = ? LIMIT 1`,
    [Number(id)]
  );
  return mapVehicleRow(rows[0]);
}

async function checkRegistrationExists(pool, registration, excludeId = 0) {
  const reg = trim(registration).toUpperCase().replace(/\s+/g, '');
  const [rows] = await pool.query(
    'SELECT id FROM vehicles WHERE registration = ? AND id != ? LIMIT 1',
    [reg, Number(excludeId) || 0]
  );
  return rows.length > 0;
}

function normalizeVehicleBody(body) {
  const registration = trim(body.registration)
    .toUpperCase()
    .replace(/\s+/g, '');
  let roadTaxDue = toMysqlDate(body.road_tax_due_date);
  let sornOpt = 'road_tax';
  if (trim(body.sorn_exempt)) {
    roadTaxDue = '';
    sornOpt = trim(body.sorn_exempt);
  }
  return {
    registration,
    make_model_id: Number(body.make_model_id),
    engine_size_id: Number(body.engine_size_id),
    transmission_id: Number(body.transmission_id),
    location_id: Number(body.location_id),
    mileage: Number(body.mileage) || 0,
    last_service_date: toMysqlDate(body.last_service_date),
    mileage_last_service: Number(body.mileage_last_service) || 0,
    mileage_service_interval: Number(body.mileage_service_interval) || 0,
    sorn_exempt_option: sornOpt,
    road_tax_due_date: roadTaxDue,
    mot_expiry_date: toMysqlDate(body.mot_expiry_date),
    include_into_alert: as01(body.include_into_alert, 1),
    include_into_issue: as01(body.include_into_issue, 1),
    include_into_mot: as01(body.include_into_mot, 1),
    include_into_roadtax: as01(body.include_into_roadtax, 1),
    include_into_service: as01(body.include_into_service, 1),
  };
}

async function createVehicle(pool, body) {
  const data = normalizeVehicleBody(body);
  if (
    !data.registration ||
    !data.make_model_id ||
    !data.engine_size_id ||
    !data.transmission_id
  ) {
    const err = new Error('Required fields can not be left blank');
    err.code = 'VALIDATION';
    throw err;
  }
  if (await checkRegistrationExists(pool, data.registration, 0)) {
    const err = new Error('Vehicle already exits with same registration');
    err.code = 'DUPLICATE';
    throw err;
  }
  const ts = nowMysql();
  const [result] = await pool.query(
    `INSERT INTO vehicles (
      registration, make_model_id, engine_size_id, transmission_id, location_id,
      mileage, last_service_date, mileage_last_service, mileage_service_interval,
      sorn_exempt_option, road_tax_due_date, mot_expiry_date,
      include_into_alert, include_into_issue, include_into_mot, include_into_roadtax, include_into_service,
      status, created_at, modified_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
    [
      data.registration,
      data.make_model_id,
      data.engine_size_id,
      data.transmission_id,
      data.location_id,
      data.mileage,
      data.last_service_date,
      data.mileage_last_service,
      data.mileage_service_interval,
      data.sorn_exempt_option,
      data.road_tax_due_date,
      data.mot_expiry_date,
      data.include_into_alert,
      data.include_into_issue,
      data.include_into_mot,
      data.include_into_roadtax,
      data.include_into_service,
      ts,
      ts,
    ]
  );
  const insertId = result.insertId;
  await setVehicleColors(pool, insertId, 'add');
  return getVehicleById(pool, insertId);
}

async function updateVehicle(pool, id, body) {
  const vehicleId = Number(id);
  const existing = await getVehicleById(pool, vehicleId);
  if (!existing) {
    const err = new Error('Vehicle not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const data = normalizeVehicleBody(body);
  if (
    !data.registration ||
    !data.make_model_id ||
    !data.engine_size_id ||
    !data.transmission_id
  ) {
    const err = new Error('Required fields can not be left blank');
    err.code = 'VALIDATION';
    throw err;
  }
  if (await checkRegistrationExists(pool, data.registration, vehicleId)) {
    const err = new Error(
      'This registration no is already registeredin used. Please enter another'
    );
    err.code = 'DUPLICATE';
    throw err;
  }
  const ts = nowMysql();
  const mileageChanged = Number(existing.mileage) !== data.mileage;
  if (mileageChanged) {
    await pool.query(
      'UPDATE vehicles SET mileage_updated_at = ? WHERE id = ?',
      [ts, vehicleId]
    );
  }
  await pool.query(
    `UPDATE vehicles SET
      registration = ?, make_model_id = ?, engine_size_id = ?, transmission_id = ?, location_id = ?,
      mileage = ?, last_service_date = ?, mileage_last_service = ?, mileage_service_interval = ?,
      sorn_exempt_option = ?, road_tax_due_date = ?, mot_expiry_date = ?,
      include_into_alert = ?, include_into_issue = ?, include_into_mot = ?, include_into_roadtax = ?, include_into_service = ?,
      modified_at = ?
     WHERE id = ?`,
    [
      data.registration,
      data.make_model_id,
      data.engine_size_id,
      data.transmission_id,
      data.location_id,
      data.mileage,
      data.last_service_date,
      data.mileage_last_service,
      data.mileage_service_interval,
      data.sorn_exempt_option,
      data.road_tax_due_date,
      data.mot_expiry_date,
      data.include_into_alert,
      data.include_into_issue,
      data.include_into_mot,
      data.include_into_roadtax,
      data.include_into_service,
      ts,
      vehicleId,
    ]
  );
  await setVehicleColors(pool, vehicleId, 'edit');
  return getVehicleById(pool, vehicleId);
}

async function deleteVehicle(pool, id) {
  const vehicleId = Number(id);
  const existing = await getVehicleById(pool, vehicleId);
  if (!existing) {
    const err = new Error('Location not found to delete');
    err.code = 'NOT_FOUND';
    throw err;
  }
  await pool.query('DELETE FROM vehicle_logs WHERE vehicle_id = ?', [vehicleId]);
  await pool.query('DELETE FROM vehicles WHERE id = ?', [vehicleId]);
}

async function updateMileages(pool, body) {
  if (
    trim(body.update_mileage_btn) !== 'submit_mileage' ||
    !body.data ||
    typeof body.data !== 'object'
  ) {
    const err = new Error('Invalid mileage update');
    err.code = 'VALIDATION';
    throw err;
  }
  const ts = nowMysql();
  for (const [key, payload] of Object.entries(body.data)) {
    let id = Number(key);
    if (!id && String(key).includes('_')) {
      id = Number(String(key).split('_').pop());
    }
    const mileage = Number(payload?.mileage ?? payload);
    if (!id || Number.isNaN(mileage)) continue;
    const [rows] = await pool.query('SELECT * FROM vehicles WHERE id = ?', [id]);
    const row = rows[0];
    if (!row) continue;
    const serviceColor = computeServiceColor({ ...row, mileage });
    if (Number(row.mileage) !== mileage) {
      await pool.query(
        'UPDATE vehicles SET mileage = ?, service_color = ?, mileage_updated_at = ? WHERE id = ?',
        [mileage, serviceColor, ts, id]
      );
    } else {
      await pool.query(
        'UPDATE vehicles SET mileage = ?, service_color = ? WHERE id = ?',
        [mileage, serviceColor, id]
      );
    }
  }
}

async function searchVehicles(pool, q) {
  const term = trim(q);
  if (!term) return [];
  const like = `%${term}%`;
  const [rows] = await pool.query(
    `${VEHICLE_SELECT} ${VEHICLE_JOINS}
     WHERE vehicles.registration LIKE ? OR mm.setting_value LIKE ?
     ORDER BY vehicles.registration ASC LIMIT 20`,
    [like, like]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    registration: r.registration || '',
    label: `${r.registration || ''} — ${r.make_model || ''}`,
  }));
}

async function getAllVehicleSettingTypes(pool) {
  const [rows] = await pool.query(
    'SELECT setting_type FROM vehicle_fleet_settings GROUP BY setting_type ORDER BY setting_type'
  );
  return rows.map((r) => String(r.setting_type));
}

async function listFleetSettings(pool, type) {
  const settingType = trim(type);
  const [rows] = await pool.query(
    `SELECT * FROM vehicle_fleet_settings
     WHERE setting_type = ? AND setting_name = 'option_name' AND status = 1
     ORDER BY order_no ASC`,
    [settingType]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    setting_type: r.setting_type,
    setting_value: r.setting_value || '',
    order_no: Number(r.order_no) || 0,
  }));
}

async function createFleetSetting(pool, body) {
  const settingType = trim(body.setting_type);
  const value = trim(body.setting_value);
  if (!value) {
    const err = new Error('Invalid Value');
    err.code = 'VALIDATION';
    throw err;
  }
  const [dup] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM vehicle_fleet_settings
     WHERE setting_value = ? AND setting_type = ? AND status = 1`,
    [value, settingType]
  );
  if (Number(dup[0]?.cnt) > 0) {
    const err = new Error('This option value is already exists');
    err.code = 'DUPLICATE';
    throw err;
  }
  const [ord] = await pool.query(
    'SELECT MAX(order_no) AS order_no FROM vehicle_fleet_settings WHERE setting_type = ?',
    [settingType]
  );
  const orderNo = Number(ord[0]?.order_no || 0) + 1;
  const [result] = await pool.query(
    `INSERT INTO vehicle_fleet_settings (setting_type, setting_name, setting_value, order_no, status)
     VALUES (?, 'option_name', ?, ?, 1)`,
    [settingType, value, orderNo]
  );
  return { id: result.insertId, setting_value: value };
}

async function updateFleetSetting(pool, id, body) {
  const settingId = Number(id);
  const value = trim(body.setting_value);
  const [rows] = await pool.query(
    'SELECT * FROM vehicle_fleet_settings WHERE id = ? LIMIT 1',
    [settingId]
  );
  const row = rows[0];
  if (!row) {
    const err = new Error('Option value not found to update');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const [dup] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM vehicle_fleet_settings
     WHERE setting_value = ? AND setting_type = ? AND status = 1 AND id <> ?`,
    [value, row.setting_type, settingId]
  );
  if (Number(dup[0]?.cnt) > 0) {
    const err = new Error('This option value is already exists');
    err.code = 'DUPLICATE';
    throw err;
  }
  await pool.query(
    'UPDATE vehicle_fleet_settings SET setting_value = ? WHERE id = ?',
    [value, settingId]
  );
}

async function deleteFleetSetting(pool, id) {
  const settingId = Number(id);
  const [rows] = await pool.query(
    'SELECT id FROM vehicle_fleet_settings WHERE id = ? LIMIT 1',
    [settingId]
  );
  if (!rows[0]) {
    const err = new Error('Option Value not found to delete');
    err.code = 'NOT_FOUND';
    throw err;
  }
  await pool.query(
    'UPDATE vehicle_fleet_settings SET status = 0, order_no = 0 WHERE id = ?',
    [settingId]
  );
}

async function getVehicleLogs(pool, vehicleId, query = {}) {
  const vid = Number(vehicleId);
  const params = [vid];
  let where = ' WHERE vehicle_logs.vehicle_id = ? ';
  if (trim(query.scr_issue_status)) {
    where += ' AND vehicle_logs.issue_status = ?';
    params.push(trim(query.scr_issue_status));
  }
  if (trim(query.scr_log)) {
    where += ' AND vehicle_logs.log_event_id = ?';
    params.push(Number(query.scr_log));
  }
  const [rows] = await pool.query(
    `SELECT vehicle_logs.*, le.setting_value AS log_events, ins.fname, ins.lname
     FROM vehicle_logs
     LEFT JOIN vehicle_fleet_settings AS le ON (
       le.setting_type = 'log_events' AND le.setting_name = 'option_name' AND le.id = vehicle_logs.log_event_id
     )
     LEFT JOIN itineraries AS ins ON ins.id > 0 AND ins.id = vehicle_logs.updated_by
     ${where}
     ORDER BY log_date DESC`,
    params
  );
  return rows.map((r) => ({
    id: Number(r.id),
    vehicle_id: Number(r.vehicle_id),
    log_date: r.log_date,
    mileage: Number(r.mileage) || 0,
    log_event_id: Number(r.log_event_id) || 0,
    log_events: r.log_events || '',
    log_notes: r.log_notes || '',
    issue_status: r.issue_status || '',
    updated_by_name: r.updated_by_name || '',
    updated_by_id: Number(r.updated_by_id) || 0,
  }));
}

async function createVehicleLog(pool, vehicleId, body, session) {
  const vid = Number(vehicleId);
  const existing = await getVehicleById(pool, vid);
  if (!existing) {
    const err = new Error('Vehicle not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const admin = session?.loggedinAdmin || {};
  const updatedByName = `${session?.admin_fristname || ''} ${session?.admin_lastname || ''}`.trim();
  const updatedById = Number(admin.admin_id) || 0;
  const ts = nowMysql();
  await pool.query(
    `INSERT INTO vehicle_logs (
      vehicle_id, log_date, mileage, log_event_id, log_notes, issue_status,
      updated_by, updated_by_name, updated_by_id, created, updated
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      vid,
      toMysqlDate(body.add_log_date || body.log_date),
      Number(body.add_log_mileage ?? body.mileage) || 0,
      Number(body.log_event_id) || 0,
      trim(body.add_log_notes ?? body.log_notes),
      trim(body.log_issue_status ?? body.issue_status),
      -1,
      updatedByName,
      updatedById,
      ts,
      ts,
    ]
  );
  await updateVehicleIssueStatus(pool, vid);
}

async function updateVehicleLog(pool, logId, body, session) {
  const lid = Number(logId);
  const [logRows] = await pool.query(
    'SELECT * FROM vehicle_logs WHERE id = ? LIMIT 1',
    [lid]
  );
  const logRow = logRows[0];
  if (!logRow) {
    const err = new Error('Vehicle log not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const vid = Number(logRow.vehicle_id);
  const admin = session?.loggedinAdmin || {};
  const updatedByName = `${session?.admin_fristname || ''} ${session?.admin_lastname || ''}`.trim();
  const updatedById = Number(admin.admin_id) || 0;
  const ts = nowMysql();
  await pool.query(
    `UPDATE vehicle_logs SET log_date = ?, mileage = ?, log_event_id = ?, log_notes = ?, issue_status = ?,
      updated_by = ?, updated_by_name = ?, updated_by_id = ?, updated = ? WHERE id = ?`,
    [
      toMysqlDate(body.add_log_date || body.log_date),
      Number(body.add_log_mileage ?? body.mileage) || 0,
      Number(body.log_event_id) || 0,
      trim(body.add_log_notes ?? body.log_notes),
      trim(body.log_issue_status ?? body.issue_status),
      -1,
      updatedByName,
      updatedById,
      ts,
      lid,
    ]
  );
  await updateVehicleIssueStatus(pool, vid);
}

async function deleteVehicleLog(pool, logId) {
  const lid = Number(logId);
  const [logRows] = await pool.query(
    'SELECT vehicle_id FROM vehicle_logs WHERE id = ? LIMIT 1',
    [lid]
  );
  const vid = Number(logRows[0]?.vehicle_id);
  await pool.query('DELETE FROM vehicle_logs WHERE id = ?', [lid]);
  if (vid) await updateVehicleIssueStatus(pool, vid);
}

async function getVehicleStatusPage(pool, query = {}) {
  const type = trim(query.type);
  const scrLoc = trim(query.scr_loc);
  const scrColor = trim(query.scr_issue_status);
  let title = '';
  let items = [];

  let locSql = '';
  const params = [];
  if (scrLoc) {
    locSql = ' AND location_id = ?';
    params.push(Number(scrLoc));
  }
  let colorSql = '';
  if (scrColor) {
    if (type === 'issue') {
      colorSql = ' AND logs.issue_status = ?';
      params.push(scrColor);
    } else if (type === 'mot') {
      colorSql = ' AND mot_color = ?';
      params.push(scrColor);
    } else if (type === 'road_tax') {
      colorSql = ' AND road_tax_color = ?';
      params.push(scrColor);
    } else if (type === 'service') {
      colorSql = ' AND service_color = ?';
      params.push(scrColor);
    }
  }

  if (type === 'issue') {
    title = "Reported Issues";
    const [idRows] = await pool.query(
      "SELECT GROUP_CONCAT(id) AS ids FROM vehicles WHERE issue_color != 'green'"
    );
    const ids = idRows[0]?.ids;
    if (ids) {
      const [rows] = await pool.query(
        `SELECT logs.id, logs.vehicle_id, logs.log_event_id, logs.log_notes,
          logs.issue_status AS color, vehicles.registration, locations.loc_abb, vfs.setting_value
         FROM vehicle_logs AS logs
         LEFT JOIN vehicles ON vehicles.id = logs.vehicle_id
         LEFT JOIN vehicle_fleet_settings AS vfs ON logs.log_event_id = vfs.id
           AND vfs.setting_type = 'log_events' AND vfs.status = 1 AND vfs.setting_name = 'option_name'
         LEFT JOIN locations ON locations.id = vehicles.location_id
         WHERE logs.vehicle_id IN (${ids}) AND vehicles.include_into_issue = 1
           AND logs.issue_status != 'green' ${locSql.replace('location_id', 'vehicles.location_id')} ${colorSql}
         ORDER BY locations.loc_abb, vehicles.registration,
           FIELD(logs.issue_status, 'red', 'purple', 'yellow')`,
        params
      );
      items = rows;
    }
  } else if (type === 'mot') {
    title = "Upcoming and Expired MOT's";
    const [rows] = await pool.query(
      `SELECT vehicles.id, registration, mot_color AS color, mot_expiry_date, locations.loc_abb
       FROM vehicles LEFT JOIN locations ON vehicles.location_id = locations.id
       WHERE mot_color NOT IN ('green', 'none') AND include_into_mot = 1 ${locSql} ${colorSql}
       ORDER BY loc_abb ASC, registration ASC`,
      params
    );
    items = rows;
  } else if (type === 'road_tax') {
    title = "Upcoming and Expired Road tax's";
    const [rows] = await pool.query(
      `SELECT vehicles.id, registration, road_tax_color AS color, road_tax_due_date,
        sorn_exempt_option, locations.loc_abb
       FROM vehicles LEFT JOIN locations ON vehicles.location_id = locations.id
       WHERE road_tax_color NOT IN ('green', 'none') AND include_into_roadtax = 1 ${locSql} ${colorSql}
       ORDER BY loc_abb ASC, registration ASC`,
      params
    );
    items = rows;
  } else if (type === 'service') {
    title = 'Upcoming and Expired Service';
    const [rows] = await pool.query(
      `SELECT vehicles.id, registration, service_color AS color, last_service_date,
        mileage_last_service, mileage, locations.loc_abb
       FROM vehicles LEFT JOIN locations ON vehicles.location_id = locations.id
       WHERE service_color NOT IN ('green', 'none') AND include_into_service = 1 ${locSql} ${colorSql}
       ORDER BY loc_abb ASC, registration ASC`,
      params
    );
    items = rows;
  }

  return { type, title, items, filters: { scr_loc: scrLoc, scr_issue_status: scrColor } };
}

async function updateVehicleLocation(pool, vid, locationId) {
  const vehicleId = Number(vid);
  const locId = Number(locationId);
  const existing = await getVehicleById(pool, vehicleId);
  if (!existing) {
    return { status: 0, message: '' };
  }
  await pool.query('UPDATE vehicles SET location_id = ? WHERE id = ?', [
    locId,
    vehicleId,
  ]);
  return { status: 1, data: [], message: '' };
}

async function updateVehicleIssueStatusAjax(pool, lid, status) {
  const logId = Number(lid);
  const [rows] = await pool.query(
    'SELECT vehicle_id FROM vehicle_logs WHERE id = ? LIMIT 1',
    [logId]
  );
  const vid = Number(rows[0]?.vehicle_id);
  if (!vid) return { status: 0, data: [], message: '' };
  await pool.query('UPDATE vehicle_logs SET issue_status = ? WHERE id = ?', [
    trim(status),
    logId,
  ]);
  await updateVehicleIssueStatus(pool, vid);
  return { status: 1, data: [], message: '' };
}

module.exports = {
  getVehicleSchedule,
  listVehicles,
  getVehicleById,
  getVehicleFormOptions,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  updateMileages,
  searchVehicles,
  getAllVehicleSettingTypes,
  listFleetSettings,
  createFleetSetting,
  updateFleetSetting,
  deleteFleetSetting,
  getVehicleLogs,
  createVehicleLog,
  updateVehicleLog,
  deleteVehicleLog,
  getVehicleStatusPage,
  updateVehicleLocation,
  updateVehicleIssueStatusAjax,
  getScheduleLocationOptions,
};
