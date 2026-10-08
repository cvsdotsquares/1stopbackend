const fs = require('fs');
const path = require('path');
const {
  trim,
  getFrontUploadDir,
  saveUniqTrueUpload,
} = require('./pageEditor/helpers');

const PER_PAGE = 10;

function uploadDir() {
  return getFrontUploadDir('');
}

function publicUrl(fileName) {
  if (!fileName) return null;
  return `/uploads/${fileName}`;
}

async function listCarousels(pool, { page = 1, name_scr = '' } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const offset = (pageNum - 1) * PER_PAGE;
  let where = ' WHERE 1=1 ';
  const params = [];
  const search = trim(name_scr);
  if (search) {
    where += ' AND caption LIKE ?';
    params.push(`%${search}%`);
  }

  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total FROM carousels ${where}`,
    params
  );
  const total = Number(countRow?.total) || 0;

  const [rows] = await pool.query(
    `SELECT * FROM carousels ${where} ORDER BY weight ASC, id ASC LIMIT ?, ?`,
    [...params, offset, PER_PAGE]
  );

  return {
    items: (rows || []).map((row) => ({
      ...row,
      carousel_banner_url: publicUrl(row.carousel_banner),
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

async function getCarouselById(pool, id) {
  const [rows] = await pool.query('SELECT * FROM carousels WHERE id = ? LIMIT 1', [
    Number(id),
  ]);
  const row = rows?.[0];
  if (!row) return null;
  return { ...row, carousel_banner_url: publicUrl(row.carousel_banner) };
}

async function createCarousel(pool, body, files) {
  const caption = trim(body.caption);
  const weight = trim(body.weight) || '0';
  const file = (files || []).find((f) => f.fieldname === 'carousel_banner');
  if (!file?.buffer?.length) {
    return { ok: false, message: 'Required fields mark with * can not be left blank' };
  }
  const carousel_banner = saveUniqTrueUpload(file, uploadDir(), 'carousel_');
  const [result] = await pool.query(
    'INSERT INTO carousels (carousel_banner, caption, weight, created) VALUES (?, ?, ?, NOW())',
    [carousel_banner, caption, weight]
  );
  return { ok: true, message: 'Carousel added successfully', id: result.insertId };
}

async function updateCarousel(pool, id, body, files) {
  const existing = await getCarouselById(pool, id);
  if (!existing) {
    return { ok: false, message: 'Carousel not found' };
  }
  const caption = trim(body.caption);
  const weight = trim(body.weight) || '0';
  let carousel_banner = existing.carousel_banner || '';
  const file = (files || []).find((f) => f.fieldname === 'carousel_banner');
  if (file?.buffer?.length) {
    const uploaded = saveUniqTrueUpload(file, uploadDir(), 'carousel_');
    if (uploaded) {
      if (carousel_banner) {
        const oldPath = path.join(uploadDir(), carousel_banner);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      carousel_banner = uploaded;
    }
  }
  await pool.query(
    'UPDATE carousels SET carousel_banner = ?, caption = ?, weight = ? WHERE id = ?',
    [carousel_banner, caption, weight, Number(id)]
  );
  return { ok: true, message: 'Carousel edited successfully' };
}

async function deleteCarousel(pool, id) {
  const existing = await getCarouselById(pool, id);
  if (!existing) {
    return { ok: false, message: 'Carousel not found to delete' };
  }
  if (existing.carousel_banner) {
    const filePath = path.join(uploadDir(), existing.carousel_banner);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  await pool.query('DELETE FROM carousels WHERE id = ?', [Number(id)]);
  return { ok: true, message: 'Carousel deleted successfully' };
}

module.exports = {
  listCarousels,
  getCarouselById,
  createCarousel,
  updateCarousel,
  deleteCarousel,
};
