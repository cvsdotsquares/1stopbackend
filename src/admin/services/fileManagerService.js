const fs = require('fs');
const path = require('path');

const ALLOWED_EXT = new Set(['jpg', 'png', 'jpeg', 'gif', 'doc', 'docx', 'pdf']);

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function getFileManagerDir() {
  const base = process.env.FRONT_IMG_DIR || path.join(process.cwd());
  const dir = path.join(base, 'cmImages', 'images');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeFileName(name) {
  const base = path.basename(trim(name));
  if (!base || base.includes('..')) return null;
  const ext = path.extname(base).replace(/^\./, '').toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return null;
  return base;
}

function listFiles({ name_scr = '' } = {}) {
  const dir = getFileManagerDir();
  const search = trim(name_scr).toLowerCase();
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const safe = safeFileName(entry.name);
    if (!safe) continue;
    if (search && !safe.toLowerCase().includes(search)) continue;
    const fullPath = path.join(dir, safe);
    const stat = fs.statSync(fullPath);
    files.push({
      name: safe,
      size: stat.size,
      modified: stat.mtime,
      modifiedMs: stat.mtimeMs,
      url: `/cmImages/images/${safe}`,
    });
  }

  files.sort((a, b) => b.modifiedMs - a.modifiedMs);
  return { directory: dir, items: files, filters: { name_scr: trim(name_scr) } };
}

function uploadFile(file) {
  if (!file?.buffer?.length) {
    return { ok: false, message: 'No file uploaded' };
  }
  const safe = safeFileName(file.originalname);
  if (!safe) {
    return { ok: false, message: 'File type not allowed' };
  }
  const dir = getFileManagerDir();
  const target = path.join(dir, safe);
  if (fs.existsSync(target)) {
    return { ok: false, message: 'File already exists' };
  }
  fs.writeFileSync(target, file.buffer);
  return { ok: true, message: 'File uploaded successfully', filename: safe };
}

function deleteFile(filename) {
  const safe = safeFileName(filename);
  if (!safe) {
    return { ok: false, message: 'Invalid file name' };
  }
  const target = path.join(getFileManagerDir(), safe);
  if (!fs.existsSync(target)) {
    return { ok: false, message: 'File not found' };
  }
  fs.unlinkSync(target);
  return { ok: true, message: 'File deleted successfully' };
}

module.exports = {
  listFiles,
  uploadFile,
  deleteFile,
  getFileManagerDir,
};
