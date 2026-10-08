const fs = require('fs');
const path = require('path');

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function getExternalCssPath() {
  const configured = trim(process.env.EXTERNAL_CSS_PATH);
  if (configured) return configured;
  const docRoot = trim(process.env.DOCUMENT_ROOT);
  if (docRoot) {
    return path.join(docRoot, 'app', 'webroot', 'css', 'overwrite.css');
  }
  return path.join(process.cwd(), 'css', 'overwrite.css');
}

function getExternalCssDir() {
  return path.dirname(getExternalCssPath());
}

function formatBackupName(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `overwrite_${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}.css`;
}

async function readExternalCss() {
  const filePath = getExternalCssPath();
  if (!fs.existsSync(filePath)) {
    return { ok: true, content: '', path: filePath, exists: false };
  }
  const content = fs.readFileSync(filePath, 'utf8');
  return { ok: true, content, path: filePath, exists: true };
}

async function saveExternalCss(body) {
  const content = body?.content ?? body?.css ?? '';
  if (!trim(content)) {
    return { ok: false, message: 'CSS content can not be left blank' };
  }

  const filePath = getExternalCssPath();
  const dir = getExternalCssDir();
  fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(filePath)) {
    const backupPath = path.join(dir, formatBackupName());
    fs.copyFileSync(filePath, backupPath);
  }

  fs.writeFileSync(filePath, content, 'utf8');
  return { ok: true, message: 'External CSS updated successfully', path: filePath };
}

module.exports = {
  getExternalCssPath,
  readExternalCss,
  saveExternalCss,
};
