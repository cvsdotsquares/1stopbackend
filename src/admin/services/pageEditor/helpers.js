const fs = require('fs');
const path = require('path');

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function decodeHtml(value) {
  const s = trim(value);
  if (!s) return '';
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function htmlEscape(value) {
  const s = String(value ?? '');
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function flag(body, key) {
  const v = body?.[key];
  return v === '1' || v === 1 || v === true ? 1 : 0;
}

function checkboxFlag(section, key) {
  return section?.[key] !== undefined && section[key] !== '' && section[key] !== '0' ? 1 : 0;
}

function positiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function fieldPathToName(parts) {
  if (typeof parts === 'string') return parts;
  if (!Array.isArray(parts) || parts.length === 0) return '';
  return parts.reduce(
    (acc, part, index) => (index === 0 ? String(part) : `${acc}[${part}]`),
    ''
  );
}

function createFileAccessor(files) {
  const list = Array.isArray(files) ? files : [];
  const byField = new Map();
  for (const file of list) {
    if (file?.fieldname) {
      byField.set(file.fieldname, file);
    }
  }

  return {
    getFile(fieldPath) {
      const name = fieldPathToName(fieldPath);
      return byField.get(name) || null;
    },
    hasAnyFieldMatching(substrings) {
      const needles = Array.isArray(substrings) ? substrings : [substrings];
      for (const key of byField.keys()) {
        if (needles.some((n) => key.includes(n))) return true;
      }
      return false;
    },
  };
}

function getFrontUploadDir(subdir) {
  const base =
    process.env.FRONT_IMG_DIR || path.join(process.cwd(), 'uploads');
  const dir = path.join(base, 'uploads', subdir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function defaultGetUploadDir(subdir) {
  return getFrontUploadDir(subdir);
}

function extensionFromName(originalname) {
  const ext = path.extname(originalname || '').replace(/^\./, '');
  return ext || 'bin';
}

function writeBufferUpload(file, uploadDir, fileName) {
  if (!file?.buffer?.length) return null;
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.writeFileSync(path.join(uploadDir, fileName), file.buffer);
  return fileName;
}

function saveUniqUpload(file, uploadDir, prefix) {
  if (!file?.buffer?.length) return null;
  const ext = extensionFromName(file.originalname);
  const name = `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${ext}`;
  return writeBufferUpload(file, uploadDir, name);
}

function saveTimeBasenameUpload(file, uploadDir) {
  if (!file?.buffer?.length) return null;
  const base = path.basename(file.originalname || 'upload.bin');
  const name = `${Date.now()}_${base}`;
  return writeBufferUpload(file, uploadDir, name);
}

function saveUniqTrueUpload(file, uploadDir, prefix) {
  if (!file?.buffer?.length) return null;
  const ext = extensionFromName(file.originalname);
  const name = `${prefix}${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}.${ext}`;
  return writeBufferUpload(file, uploadDir, name);
}

async function upsertJunction(pool, opts) {
  const {
    dataId,
    dataType,
    sectionData,
    sectionId = null,
    sortOrder = 1,
  } = opts;

  let rows;
  if (sectionId != null && sectionId !== '') {
    [rows] = await pool.query(
      `SELECT id FROM page_junction
       WHERE data_id = ? AND data_type = ? AND section_data = ? AND section_id = ?`,
      [dataId, dataType, sectionData, sectionId]
    );
  } else {
    [rows] = await pool.query(
      `SELECT id FROM page_junction
       WHERE data_id = ? AND data_type = ? AND section_data = ?
       AND (section_id IS NULL OR section_id = 0)`,
      [dataId, dataType, sectionData]
    );
  }

  if (rows?.length) {
    await pool.query(`UPDATE page_junction SET sort_order = ? WHERE id = ?`, [
      sortOrder,
      rows[0].id,
    ]);
    return rows[0].id;
  }

  const [result] = await pool.query(
    `INSERT INTO page_junction (data_id, data_type, section_data, sort_order, section_id)
     VALUES (?, ?, ?, ?, ?)`,
    [dataId, dataType, sectionData, sortOrder, sectionId]
  );
  return result.insertId;
}

async function ensureJunctionExists(pool, dataId, dataType, sectionData) {
  const [rows] = await pool.query(
    `SELECT id FROM page_junction WHERE data_id = ? AND data_type = ? AND section_data = ? LIMIT 1`,
    [dataId, dataType, sectionData]
  );
  if (rows?.length) return rows[0].id;
  const [result] = await pool.query(
    `INSERT INTO page_junction (data_id, data_type, section_data) VALUES (?, ?, ?)`,
    [dataId, dataType, sectionData]
  );
  return result.insertId;
}

module.exports = {
  trim,
  decodeHtml,
  htmlEscape,
  flag,
  checkboxFlag,
  positiveInt,
  fieldPathToName,
  createFileAccessor,
  getFrontUploadDir,
  defaultGetUploadDir,
  saveUniqUpload,
  saveUniqTrueUpload,
  saveTimeBasenameUpload,
  upsertJunction,
  ensureJunctionExists,
};
