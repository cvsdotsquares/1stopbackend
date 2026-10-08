const { saveAllSections } = require('./sectionSavers');

/**
 * Persist CMS page section payloads (legacy edit_page.php POST handlers).
 *
 * @param {import('mysql2/promise').Pool} pool
 * @param {{ pageId: number, dataType?: string, body: object, files?: Array<{ fieldname: string, buffer: Buffer, originalname: string }>, getUploadDir?: (subdir: string) => string }} options
 */
async function savePageSections(pool, { pageId, dataType = 'page', body, files, getUploadDir }) {
  if (!pool) throw new Error('savePageSections requires pool');
  if (!pageId) throw new Error('savePageSections requires pageId');
  if (!body || typeof body !== 'object') {
    throw new Error('savePageSections requires body object');
  }

  await saveAllSections(pool, {
    pageId: Number(pageId),
    dataType: dataType || 'page',
    body,
    files: files || [],
    getUploadDir,
  });
}

module.exports = {
  savePageSections,
};
