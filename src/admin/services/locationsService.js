const fs = require('fs');
const path = require('path');

const RECORDS_PER_PAGE = 10;
const ALLOWED_IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif']);

function trim(value) {
  return value == null ? '' : String(value).trim();
}

const DEFAULT_DASHBOARD_COLOR = '#94a3b8';

function normalizeDashboardColor(value) {
  const raw = trim(value);
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) {
    return raw.toLowerCase();
  }
  return DEFAULT_DASHBOARD_COLOR;
}

function getMapsUploadDir() {
  const base =
    process.env.FRONT_IMG_DIR ||
    process.env.MAPS_UPLOAD_DIR ||
    path.join(process.cwd(), 'uploads');
  const mapsDir = path.join(base, 'maps');
  fs.mkdirSync(mapsDir, { recursive: true });
  return mapsDir;
}

function usesFrontMapsDir() {
  return Boolean(trim(process.env.FRONT_IMG_DIR));
}

function getMapsPublicBaseUrl(req) {
  const { getSiteUrl, getRequestBaseUrl } = require('../utils/siteUrl');

  if (usesFrontMapsDir()) {
    const siteUrl = getSiteUrl(req);
    if (siteUrl) {
      return `${siteUrl.replace(/\/$/, '')}/maps`;
    }
  }

  const apiBase = getRequestBaseUrl(req);
  if (apiBase) {
    return `${apiBase}/maps`;
  }

  return '/maps';
}

function mapLocationRow(row, mapsBaseUrl = '/maps') {
  if (!row) return null;
  const directionMap = row.direction_map || '';
  return {
    id: row.id,
    location_name: row.location_name,
    loc_abb: row.loc_abb,
    address1: row.address1,
    address2: row.address2,
    address3: row.address3,
    address4: row.address4,
    postcode: row.postcode,
    latitude: row.latitude,
    longitude: row.longitude,
    map_title: row.map_title,
    direction_content: row.direction_content,
    direction_map: directionMap,
    direction_map_url: directionMap
      ? `${mapsBaseUrl.replace(/\/$/, '')}/${directionMap}`
      : null,
    show_in_dl_return: Number(row.show_in_dl_return) || 0,
    show_in_vehicle_schedule: Number(row.show_in_vehicle_schedule) || 0,
    show_as_location_for_courses:
      row.show_as_location_for_courses == null
        ? 1
        : Number(row.show_as_location_for_courses) || 0,
    dashboard_color: normalizeDashboardColor(row.dashboard_color),
    status: row.status,
    created: row.created,
  };
}

function buildListWhere(searchterm) {
  let where = " WHERE locations.id != '' AND locations.status = '1' ";
  const params = [];

  const nameScr = trim(searchterm?.name_scr);
  const addScr = trim(searchterm?.add_scr);

  if (nameScr) {
    where += ' AND locations.location_name LIKE ?';
    params.push(`%${nameScr}%`);
  }

  if (addScr) {
    where +=
      ' AND (locations.address1 LIKE ? OR locations.address2 LIKE ? OR locations.address3 LIKE ? OR locations.address4 LIKE ? OR locations.postcode LIKE ?)';
    const like = `%${addScr}%`;
    params.push(like, like, like, like, like);
  }

  return { where, params };
}

async function listLocations(pool, { page = 1, searchterm = {}, mapsBaseUrl = '/maps' } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const { where, params } = buildListWhere(searchterm);
  const offset = (pageNum - 1) * RECORDS_PER_PAGE;

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM locations ${where}`,
    params
  );
  const total = Number(countRows?.[0]?.total) || 0;

  const [rows] = await pool.query(
    `SELECT * FROM locations ${where} ORDER BY locations.id DESC LIMIT ?, ?`,
    [...params, offset, RECORDS_PER_PAGE]
  );

  return {
    items: (rows || []).map((row) => mapLocationRow(row, mapsBaseUrl)),
    pagination: {
      page: pageNum,
      perPage: RECORDS_PER_PAGE,
      total,
      totalPages: Math.max(1, Math.ceil(total / RECORDS_PER_PAGE)),
    },
    filters: {
      name_scr: trim(searchterm?.name_scr),
      add_scr: trim(searchterm?.add_scr),
      sort: trim(searchterm?.sort),
    },
  };
}

async function getLocationById(pool, id, mapsBaseUrl = '/maps') {
  const [rows] = await pool.query('SELECT * FROM locations WHERE id = ? LIMIT 1', [
    id,
  ]);
  return mapLocationRow(rows?.[0], mapsBaseUrl);
}

async function locationExistsActiveById(pool, id) {
  const [rows] = await pool.query(
    "SELECT id FROM locations WHERE id = ? AND status = '1' LIMIT 1",
    [id]
  );
  return Boolean(rows?.length);
}

async function locationExistsByName(pool, name, excludeId = null) {
  let sql =
    "SELECT id FROM locations WHERE location_name = ? AND status = '1'";
  const params = [name];
  if (excludeId != null) {
    sql += ' AND id != ?';
    params.push(excludeId);
  }
  sql += ' LIMIT 1';
  const [rows] = await pool.query(sql, params);
  return Boolean(rows?.length);
}

async function otherLocationExistsByName(pool, name, id) {
  const [rows] = await pool.query(
    'SELECT id FROM locations WHERE location_name = ? AND id != ? LIMIT 1',
    [name, id]
  );
  return Boolean(rows?.length);
}

function validateRequiredFields(body, isEdit = false) {
  const locationName = trim(body.location_name);
  const address1 = trim(body.address1);
  const postcode = trim(body.postcode);
  const locAbb = trim(body.loc_abb);
  const id = trim(body.id);

  if (isEdit) {
    if (
      !locationName ||
      !address1 ||
      !postcode ||
      !locAbb ||
      !id
    ) {
      return {
        ok: false,
        message: 'Required fields mark with * can not be left blank',
      };
    }
  } else if (!locationName || !address1 || !postcode || !locAbb) {
    return {
      ok: false,
      message: 'Required fields can not be left blank',
    };
  }

  return {
    ok: true,
    data: {
      location_name: locationName,
      address1,
      address2: trim(body.address2),
      address3: trim(body.address3),
      address4: trim(body.address4),
      postcode,
      latitude: trim(body.latitude),
      longitude: trim(body.longitude),
      map_title: trim(body.map_title),
      loc_abb: locAbb,
      direction_content: trim(body.direction_content),
      show_in_dl_return:
        String(body.show_in_dl_return ?? '0') === '1' ? 1 : 0,
      show_in_vehicle_schedule:
        String(body.show_in_vehicle_schedule ?? '0') === '1' ? 1 : 0,
      show_as_location_for_courses:
        String(body.show_as_location_for_courses ?? '0') === '1' ? 1 : 0,
      dashboard_color: normalizeDashboardColor(body.dashboard_color),
      id: id || undefined,
    },
  };
}

function saveUploadedDirectionMap(file) {
  if (!file || !file.originalname) {
    return { ok: true, filename: '' };
  }

  const ext = path.extname(file.originalname).slice(1).toLowerCase();
  if (!ALLOWED_IMAGE_EXT.has(ext)) {
    return {
      ok: false,
      message: 'File type is not correct for direction_map',
    };
  }

  const filename = `direction_map_${Date.now()}.${ext}`;
  const target = path.join(getMapsUploadDir(), filename);
  fs.writeFileSync(target, file.buffer);
  return { ok: true, filename };
}

function deleteDirectionMapFile(filename) {
  if (!filename) return;
  const target = path.join(getMapsUploadDir(), filename);
  if (fs.existsSync(target)) {
    fs.unlinkSync(target);
  }
}

async function createLocation(pool, body, file) {
  const validation = validateRequiredFields(body, false);
  if (!validation.ok) {
    return validation;
  }

  const data = validation.data;
  const exists = await locationExistsByName(pool, data.location_name);
  if (exists) {
    return {
      ok: false,
      message: 'Location already exits with same location name',
    };
  }

  let directionMap = '';
  if (file) {
    const upload = saveUploadedDirectionMap(file);
    if (!upload.ok) {
      return upload;
    }
    directionMap = upload.filename;
  }

  const now = new Date();
  const created = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  const [result] = await pool.query(
    `INSERT INTO locations (
      location_name, address1, address2, address3, address4, postcode,
      latitude, longitude, status, created, map_title, loc_abb,
      direction_content, direction_map, show_in_dl_return, show_in_vehicle_schedule,
      show_as_location_for_courses, dashboard_color
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.location_name,
      data.address1,
      data.address2,
      data.address3,
      data.address4,
      data.postcode,
      data.latitude,
      data.longitude,
      '1',
      created,
      data.map_title,
      data.loc_abb,
      data.direction_content,
      directionMap,
      data.show_in_dl_return,
      data.show_in_vehicle_schedule,
      data.show_as_location_for_courses,
      data.dashboard_color,
    ]
  );

  if (!result?.insertId) {
    return { ok: false, message: 'Error in adding location' };
  }

  return {
    ok: true,
    message: 'Location added successfully',
    data: { id: result.insertId },
  };
}

async function updateLocation(pool, id, body, file, existingDirectionMap) {
  const bodyWithId = { ...body, id: String(id) };
  const validation = validateRequiredFields(bodyWithId, true);
  if (!validation.ok) {
    return validation;
  }

  const data = validation.data;
  const exists = await locationExistsActiveById(pool, id);
  if (!exists) {
    return { ok: false, message: 'Location not found to edit' };
  }

  const duplicate = await otherLocationExistsByName(
    pool,
    data.location_name,
    id
  );
  if (duplicate) {
    return {
      ok: false,
      message: 'Other location already exits with same location name',
    };
  }

  let directionMap = existingDirectionMap || '';
  const removeDirectionMap =
    String(body.remove_direction_map ?? '') === '1' ||
    String(body.remove_direction_map ?? '').toLowerCase() === 'true';

  if (removeDirectionMap) {
    if (directionMap) {
      deleteDirectionMapFile(directionMap);
    }
    directionMap = '';
  } else if (file) {
    const upload = saveUploadedDirectionMap(file);
    if (!upload.ok) {
      return upload;
    }
    if (directionMap && directionMap !== upload.filename) {
      deleteDirectionMapFile(directionMap);
    }
    directionMap = upload.filename;
  }

  const [result] = await pool.query(
    `UPDATE locations SET
      location_name = ?, address1 = ?, address2 = ?, address3 = ?, address4 = ?,
      postcode = ?, latitude = ?, longitude = ?, status = ?, map_title = ?,
      loc_abb = ?, direction_content = ?, direction_map = ?,
      show_in_dl_return = ?, show_in_vehicle_schedule = ?,
      show_as_location_for_courses = ?, dashboard_color = ?
    WHERE id = ?`,
    [
      data.location_name,
      data.address1,
      data.address2,
      data.address3,
      data.address4,
      data.postcode,
      data.latitude,
      data.longitude,
      '1',
      data.map_title,
      data.loc_abb,
      data.direction_content,
      directionMap,
      data.show_in_dl_return,
      data.show_in_vehicle_schedule,
      data.show_as_location_for_courses,
      data.dashboard_color,
      id,
    ]
  );

  if (!result?.affectedRows) {
    return { ok: false, message: 'Error in updating location' };
  }

  return { ok: true, message: 'Location updated successfully' };
}

async function softDeleteLocation(pool, id) {
  const exists = await locationExistsActiveById(pool, id);
  if (!exists) {
    return { ok: false, message: 'Location not found to delete' };
  }

  const [result] = await pool.query(
    "UPDATE locations SET status = '0' WHERE id = ?",
    [id]
  );

  if (!result?.affectedRows) {
    return { ok: false, message: 'Error in deleting location' };
  }

  return { ok: true, message: 'Location deleted successfully' };
}

module.exports = {
  RECORDS_PER_PAGE,
  listLocations,
  getLocationById,
  createLocation,
  updateLocation,
  softDeleteLocation,
  getMapsPublicBaseUrl,
  getMapsUploadDir,
};
