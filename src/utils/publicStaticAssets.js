const fs = require('fs');
const path = require('path');
const express = require('express');

/**
 * Same base as page editor uploads (getFrontUploadDir in pageEditor/helpers.js).
 * Files live under `{base}/uploads/{subdir}/…` and are exposed at `/uploads/{subdir}/…`.
 */
function getFrontAssetsBaseDir() {
  const configured = process.env.FRONT_IMG_DIR;
  if (configured && String(configured).trim()) {
    return path.resolve(String(configured).trim());
  }
  return path.join(process.cwd(), 'uploads');
}

function getPublicUploadsDir() {
  return path.join(getFrontAssetsBaseDir(), 'uploads');
}

function registerPublicStaticAssets(app) {
  const uploadsDir = getPublicUploadsDir();
  fs.mkdirSync(uploadsDir, { recursive: true });
  app.use(
    '/uploads',
    express.static(uploadsDir, {
      index: false,
      fallthrough: true,
      maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
    })
  );

  const cmImagesDir = path.join(getFrontAssetsBaseDir(), 'cmImages');
  if (fs.existsSync(cmImagesDir)) {
    app.use(
      '/cmImages',
      express.static(cmImagesDir, {
        index: false,
        fallthrough: true,
        maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
      })
    );
  }

  console.log('[STATIC] GET /uploads/* ->', uploadsDir);
  if (fs.existsSync(cmImagesDir)) {
    console.log('[STATIC] GET /cmImages/* ->', cmImagesDir);
  }
}

module.exports = {
  getFrontAssetsBaseDir,
  getPublicUploadsDir,
  registerPublicStaticAssets,
};
