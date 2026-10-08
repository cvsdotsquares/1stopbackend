const fs = require('fs');
const path = require('path');
const {
  trim,
  getFrontUploadDir,
  saveTimeBasenameUpload,
} = require('./pageEditor/helpers');

const UPLOAD_SUBDIR = 'featured_services';
const {
  normalizeUploadPath,
  resolvePublicUploadUrl,
} = require('../utils/publicUploadUrl');

function uploadDir() {
  return getFrontUploadDir(UPLOAD_SUBDIR);
}

function mapFeaturedServiceRow(row, req, index) {
  const service_file_path = normalizeUploadPath(row.service_file, UPLOAD_SUBDIR);
  return {
    ...row,
    row_num: index != null ? index + 1 : undefined,
    service_file_path,
    service_file_url: resolvePublicUploadUrl(row.service_file, UPLOAD_SUBDIR, req),
  };
}

async function listFeaturedServices(pool, req) {
  const [rows] = await pool.query(
    'SELECT * FROM featured_services ORDER BY id DESC'
  );
  return (rows || []).map((row, index) => mapFeaturedServiceRow(row, req, index));
}

async function getFeaturedServiceById(pool, id, req) {
  const [rows] = await pool.query(
    'SELECT * FROM featured_services WHERE id = ? LIMIT 1',
    [Number(id)]
  );
  const row = rows?.[0];
  if (!row) return null;
  return mapFeaturedServiceRow(row, req);
}

async function createFeaturedService(pool, body, files) {
  const service_title = trim(body.service_title);
  const service_link = trim(body.service_link);
  if (!service_title || !service_link) {
    return { ok: false, message: 'Title and Link are required' };
  }

  let service_file = '';
  const file = (files || []).find((f) => f.fieldname === 'service_file');
  if (file?.buffer?.length) {
    service_file = saveTimeBasenameUpload(file, uploadDir()) || '';
  }

  const [result] = await pool.query(
    'INSERT INTO featured_services (service_title, service_file, service_link) VALUES (?, ?, ?)',
    [service_title, service_file, service_link]
  );

  return {
    ok: true,
    message: 'Featured service added successfully',
    id: result.insertId,
  };
}

async function updateFeaturedService(pool, id, body, files) {
  const existing = await getFeaturedServiceById(pool, id, null);
  if (!existing) {
    return { ok: false, message: 'Featured service not found' };
  }

  const service_title = trim(body.service_title);
  const service_link = trim(body.service_link);
  if (!service_title || !service_link) {
    return { ok: false, message: 'Title and Link are required' };
  }

  let service_file = existing.service_file || '';
  const file = (files || []).find((f) => f.fieldname === 'service_file');
  if (file?.buffer?.length) {
    const uploaded = saveTimeBasenameUpload(file, uploadDir());
    if (uploaded) {
      if (service_file) {
        const oldPath = path.join(uploadDir(), service_file);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      service_file = uploaded;
    }
  }

  await pool.query(
    'UPDATE featured_services SET service_title = ?, service_file = ?, service_link = ? WHERE id = ?',
    [service_title, service_file, service_link, Number(id)]
  );

  return { ok: true, message: 'Featured service updated successfully' };
}

async function deleteFeaturedService(pool, id) {
  const existing = await getFeaturedServiceById(pool, id, null);
  if (!existing) {
    return { ok: false, message: 'Service not found' };
  }

  if (existing.service_file) {
    const filePath = path.join(uploadDir(), existing.service_file);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  await pool.query('DELETE FROM featured_services WHERE id = ?', [Number(id)]);
  return { ok: true, message: 'Service deleted successfully' };
}

module.exports = {
  listFeaturedServices,
  getFeaturedServiceById,
  createFeaturedService,
  updateFeaturedService,
  deleteFeaturedService,
};
