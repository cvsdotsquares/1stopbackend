const { phpUnserialize } = require('../../utils/phpSerialize');

/**
 * Load settings row, merge unserialized `extra`, omit registraion_email_content.
 * Mirrors login.php session settings setup.
 */
async function loadAdminSettings(pool) {
  const [rows] = await pool.query('SELECT * FROM settings LIMIT 1');
  if (!rows || rows.length === 0) {
    return {};
  }

  const settings = { ...rows[0] };
  const extra = settings.extra ? phpUnserialize(settings.extra) : null;

  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    Object.assign(settings, extra);
  }

  delete settings.registraion_email_content;
  return settings;
}

module.exports = { loadAdminSettings };
