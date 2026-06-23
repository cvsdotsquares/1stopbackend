const { mc_decrypt } = require('../../utils/universalPassword');
const { loadAdminSettings } = require('../services/settingsService');
const { sanitizeLoggedInAdmin } = require('../middleware/adminAuth');
const { getAdminSessionCookieOptions } = require('../sessionCookie');

function getEncryptionKey() {
  return process.env.UNIVERSAL_PASSWORD_KEY || process.env.ENCRYPTION_KEY;
}

class AdminAuthController {
  constructor(pool) {
    this.pool = pool;
  }

  async branding(req, res) {
    try {
      const [rows] = await this.pool.query(
        'SELECT admin_logo_url FROM settings LIMIT 1'
      );
      const adminLogoUrl =
        rows && rows.length > 0 && rows[0].admin_logo_url
          ? rows[0].admin_logo_url
          : null;

      const legacyAdminBase = (
        process.env.LEGACY_ADMIN_URL ||
        process.env.PHP_SITE_URL ||
        ''
      ).replace(/\/$/, '');

      const logoUrl =
        adminLogoUrl && legacyAdminBase
          ? `${legacyAdminBase}/uploads/${adminLogoUrl}`
          : null;

      return res.json({
        success: true,
        data: {
          admin_logo_url: adminLogoUrl,
          logo_url: logoUrl,
        },
      });
    } catch (err) {
      console.error('[ADMIN][AUTH][BRANDING]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load branding',
      });
    }
  }

  async login(req, res) {
    const { user, pass } = req.body || {};

    if (!user || !pass) {
      return res.status(401).json({
        success: false,
        message: 'Username and password incorrect.',
      });
    }

    try {
      const [rows] = await this.pool.query(
        'SELECT * FROM admin WHERE status = 1 AND admin_username = ? LIMIT 1',
        [user]
      );

      if (!rows || rows.length === 0) {
        return res.status(401).json({
          success: false,
          message: 'Username and password incorrect.',
        });
      }

      const adminRow = rows[0];
      const keyHex = getEncryptionKey();
      if (!keyHex) {
        console.error('[ADMIN][AUTH][LOGIN] ENCRYPTION_KEY not configured');
        return res.status(500).json({
          success: false,
          message: 'Server configuration error',
        });
      }

      const decryptedPass = mc_decrypt(adminRow.admin_pass, keyHex);
      if (decryptedPass === false || pass !== decryptedPass) {
        return res.status(401).json({
          success: false,
          message: 'Username and password incorrect.',
        });
      }

      const settings = await loadAdminSettings(this.pool);

      req.session.admin = user;
      req.session.admin_fristname = adminRow.admin_fristname;
      req.session.admin_lastname = adminRow.admin_lastname;
      req.session.loggedinAdmin = adminRow;
      req.session.settings = settings;

      return req.session.save((saveErr) => {
        if (saveErr) {
          console.error('[ADMIN][AUTH][LOGIN] session save failed:', saveErr.message);
          return res.status(500).json({
            success: false,
            message: 'Unable to create session',
          });
        }

        return res.json({
          success: true,
          data: {
            admin_fristname: adminRow.admin_fristname,
            admin_lastname: adminRow.admin_lastname,
            admin_username: adminRow.admin_username,
            role: adminRow.role || 'member',
          },
        });
      });
    } catch (err) {
      console.error('[ADMIN][AUTH][LOGIN]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Login failed',
      });
    }
  }

  me(req, res) {
    if (!req.session || !req.session.admin) {
      // 200 (not 401) so the login page can probe session without console noise.
      return res.json({
        success: false,
        data: null,
      });
    }

    return res.json({
      success: true,
      data: {
        admin: req.session.admin,
        admin_fristname: req.session.admin_fristname,
        admin_lastname: req.session.admin_lastname,
        loggedinAdmin: sanitizeLoggedInAdmin(req.session.loggedinAdmin),
        settings: req.session.settings,
      },
    });
  }

  logout(req, res) {
    req.session.destroy((err) => {
      if (err) {
        console.error('[ADMIN][AUTH][LOGOUT]', err.message);
        return res.status(500).json({
          success: false,
          message: 'Logout failed',
        });
      }

      res.clearCookie('connect.sid', getAdminSessionCookieOptions());

      return res.json({ success: true });
    });
  }
}

module.exports = AdminAuthController;
