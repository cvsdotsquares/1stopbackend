const fs = require('fs');
const path = require('path');
const {
  trim,
  getFrontUploadDir,
  saveTimeBasenameUpload,
} = require('./pageEditor/helpers');

const PER_PAGE = 10;

function uploadDir() {
  return getFrontUploadDir('');
}

function publicUrl(fileName) {
  if (!fileName) return null;
  return `/uploads/${fileName}`;
}

async function listFooterImages(pool, { page = 1, name_scr = '' } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const offset = (pageNum - 1) * PER_PAGE;
  let where = ' WHERE 1=1 ';
  const params = [];
  const search = trim(name_scr);
  if (search) {
    where += ' AND image_name LIKE ?';
    params.push(`%${search}%`);
  }

  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total FROM footer_images ${where}`,
    params
  );
  const total = Number(countRow?.total) || 0;

  const [rows] = await pool.query(
    `SELECT * FROM footer_images ${where} ORDER BY id DESC LIMIT ?, ?`,
    [...params, offset, PER_PAGE]
  );

  return {
    items: (rows || []).map((row) => ({
      ...row,
      image_url: publicUrl(row.image_name),
    })),
    pagination: {
      page: pageNum,
      perPage: PER_PAGE,
      total,
      totalPages: Math.max(1, Math.ceil(total / PER_PAGE)),
    },
    filters: { name_scr: search },
  };
}

async function getFooterImageById(pool, id) {
  const [rows] = await pool.query('SELECT * FROM footer_images WHERE id = ? LIMIT 1', [
    Number(id),
  ]);
  const row = rows?.[0];
  if (!row) return null;
  return { ...row, image_url: publicUrl(row.image_name) };
}

async function createFooterImage(pool, body, files) {
  const footer_type = trim(body.footer_type);
  const file = (files || []).find((f) => f.fieldname === 'image_name' || f.fieldname === 'image');
  if (!footer_type || !file?.buffer?.length) {
    return { ok: false, message: 'Required fields mark with * can not be left blank' };
  }
  if (footer_type !== '1' && footer_type !== '2') {
    return { ok: false, message: 'Invalid footer type' };
  }
  const image_name = saveTimeBasenameUpload(file, uploadDir());
  const [result] = await pool.query(
    'INSERT INTO footer_images (footer_type, image_name) VALUES (?, ?)',
    [footer_type, image_name]
  );
  return { ok: true, message: 'Footer image added successfully', id: result.insertId };
}

async function updateFooterImage(pool, id, body, files) {
  const existing = await getFooterImageById(pool, id);
  if (!existing) {
    return { ok: false, message: 'Footer image not found' };
  }
  const footer_type = trim(body.footer_type);
  if (!footer_type || (footer_type !== '1' && footer_type !== '2')) {
    return { ok: false, message: 'Required fields mark with * can not be left blank' };
  }
  let image_name = existing.image_name || '';
  const file = (files || []).find((f) => f.fieldname === 'image_name' || f.fieldname === 'image');
  if (file?.buffer?.length) {
    const uploaded = saveTimeBasenameUpload(file, uploadDir());
    if (uploaded) {
      if (image_name) {
        const oldPath = path.join(uploadDir(), image_name);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      image_name = uploaded;
    }
  }
  await pool.query('UPDATE footer_images SET footer_type = ?, image_name = ? WHERE id = ?', [
    footer_type,
    image_name,
    Number(id),
  ]);
  return { ok: true, message: 'Footer image edited successfully' };
}

async function deleteFooterImage(pool, id) {
  const existing = await getFooterImageById(pool, id);
  if (!existing) {
    return { ok: false, message: 'Footer image not found to delete' };
  }
  if (existing.image_name) {
    const filePath = path.join(uploadDir(), existing.image_name);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  await pool.query('DELETE FROM footer_images WHERE id = ?', [Number(id)]);
  return { ok: true, message: 'Footer image deleted successfully' };
}

module.exports = {
  listFooterImages,
  getFooterImageById,
  createFooterImage,
  updateFooterImage,
  deleteFooterImage,
};
