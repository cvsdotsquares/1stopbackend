/**
 * Upload helpers for CMS section images (legacy FRONT_IMG_DIR/uploads/<folder>).
 */
const fs = require('fs');
const path = require('path');

const ALLOWED_FOLDERS = new Set([
  'sliders',
  'direct_access',
  'services',
  'cbt_across_london',
  'cbt_test_london',
  'expert_training',
  'why_1stop',
  'exceptional',
  'pages_banner',
  'dynamic_content',
  'directions',
  'info_cards',
  'content_cards',
]);

const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp']);

function getUploadsRoot() {
  const base =
    process.env.FRONT_IMG_DIR || path.join(process.cwd(), 'uploads');
  const uploadsDir = path.join(base, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  return uploadsDir;
}

function uploadSectionImage(file, folder) {
  const folderName = String(folder || '').trim();
  if (!ALLOWED_FOLDERS.has(folderName)) {
    return { ok: false, message: 'Invalid upload folder' };
  }
  if (!file || !file.originalname || !file.buffer) {
    return { ok: false, message: 'No image file provided' };
  }

  const ext = path.extname(file.originalname).slice(1).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    return { ok: false, message: 'File type is not allowed' };
  }

  const dir = path.join(getUploadsRoot(), folderName);
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${folderName}_${Date.now()}_${Math.round(Math.random() * 1e6)}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), file.buffer);

  return {
    ok: true,
    data: {
      filename,
      folder: folderName,
      path: `${folderName}/${filename}`,
    },
  };
}

module.exports = {
  ALLOWED_FOLDERS,
  uploadSectionImage,
  getUploadsRoot,
};
