const fs = require('fs');
const path = require('path');
const { trim, getFrontUploadDir, saveUniqUpload } = require('./pageEditor/helpers');
const {
  normalizeUploadPath,
  resolvePublicUploadUrl,
} = require('../utils/publicUploadUrl');

const SUB = 'accreditations';

function mapAccreditationRow(row, req, index) {
  const image_path = normalizeUploadPath(row.image, SUB);
  return {
    ...row,
    row_num: index != null ? index + 1 : undefined,
    image_path,
    image_url: resolvePublicUploadUrl(row.image, SUB, req),
  };
}

async function listAccreditations(pool, req) {
  const [rows] = await pool.query('SELECT * FROM accreditations ORDER BY weight ASC, id ASC');
  return (rows || []).map((row, i) => mapAccreditationRow(row, req, i));
}

async function getAccreditationById(pool, id, req) {
  const [rows] = await pool.query('SELECT * FROM accreditations WHERE id = ? LIMIT 1', [
    Number(id),
  ]);
  const row = rows?.[0];
  if (!row) return null;
  return mapAccreditationRow(row, req);
}

async function createAccreditation(pool, body, files) {
  const weight = trim(body.weight);
  const file = (files || []).find((f) => f.fieldname === 'image');
  if (!weight || !file?.buffer?.length) {
    return { ok: false, message: 'Required fields mark with * can not be left blank' };
  }
  const image = saveUniqUpload(file, getFrontUploadDir(SUB), 'acc_');
  const [result] = await pool.query(
    'INSERT INTO accreditations (image, weight, modified) VALUES (?, ?, NOW())',
    [image, weight]
  );
  return { ok: true, message: 'Accreditation added successfully', id: result.insertId };
}

async function updateAccreditation(pool, id, body, files) {
  const existing = await getAccreditationById(pool, id, null);
  if (!existing) return { ok: false, message: 'Accreditation not found' };
  const weight = trim(body.weight);
  if (!weight) {
    return { ok: false, message: 'Required fields mark with * can not be left blank' };
  }
  let image = existing.image;
  const file = (files || []).find((f) => f.fieldname === 'image');
  if (file?.buffer?.length) {
    const uploaded = saveUniqUpload(file, getFrontUploadDir(SUB), 'acc_');
    if (uploaded) {
      if (image) {
        const oldName = path.basename(String(image).replace(/\\/g, '/'));
        const old = path.join(getFrontUploadDir(SUB), oldName);
        if (fs.existsSync(old)) fs.unlinkSync(old);
      }
      image = uploaded;
    }
  }
  await pool.query('UPDATE accreditations SET image = ?, weight = ?, modified = NOW() WHERE id = ?', [
    image,
    weight,
    Number(id),
  ]);
  return { ok: true, message: 'Accreditation edited successfully' };
}

async function deleteAccreditation(pool, id) {
  const existing = await getAccreditationById(pool, id, null);
  if (!existing) return { ok: false, message: 'Accreditation not found to delete' };
  if (existing.image) {
    const fileName = path.basename(String(existing.image).replace(/\\/g, '/'));
    const p = path.join(getFrontUploadDir(SUB), fileName);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  await pool.query('DELETE FROM accreditations WHERE id = ?', [Number(id)]);
  return { ok: true, message: 'Accreditation deleted successfully' };
}

module.exports = {
  listAccreditations,
  getAccreditationById,
  createAccreditation,
  updateAccreditation,
  deleteAccreditation,
};
