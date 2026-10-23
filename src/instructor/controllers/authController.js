const { authenticateInstructor } = require('../services/instructorAuthService');
const { sanitizeLoggedInInstructor } = require('../middleware/instructorAuth');
const { getInstructorSessionCookieOptions } = require('../sessionCookie');

class InstructorAuthController {
  constructor(pool) {
    this.pool = pool;
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
      const authResult = await authenticateInstructor(this.pool, String(user).trim(), String(pass).trim());

      if (!authResult.ok) {
        return res.status(401).json({
          success: false,
          message: authResult.message || 'Username and password incorrect.',
        });
      }

      const instructor = authResult.instructor;
      const sanitized = sanitizeLoggedInInstructor(instructor);

      req.session.instructor = instructor.username;
      req.session.instructor_id = instructor.id;
      req.session.fname = instructor.fname;
      req.session.lname = instructor.lname;
      req.session.instructor_certificate_number = instructor.instructor_certificate_number;
      req.session.location = instructor.location;
      req.session.location_name = instructor.location_name || null;
      req.session.loggedinInstructor = sanitized;

      return req.session.save((saveErr) => {
        if (saveErr) {
          console.error('[INSTRUCTOR][AUTH][LOGIN] Session save failed:', saveErr.message);
          return res.status(500).json({
            success: false,
            message: 'Unable to create session',
          });
        }

        return res.json({
          success: true,
          data: {
            instructor: instructor.username,
            instructor_id: instructor.id,
            fname: instructor.fname,
            lname: instructor.lname,
            instructor_certificate_number: instructor.instructor_certificate_number,
            location: instructor.location,
            location_name: instructor.location_name || null,
          },
        });
      });
    } catch (err) {
      console.error('[INSTRUCTOR][AUTH][LOGIN] Error:', err);
      return res.status(500).json({
        success: false,
        message: 'Internal server error during login',
      });
    }
  }

  async me(req, res) {
    if (!req.session || !req.session.instructor || !req.session.instructor_id) {
      return res.status(401).json({
        success: false,
        message: 'Not authenticated',
      });
    }

    return res.json({
      success: true,
      data: {
        instructor: req.session.instructor,
        instructor_id: req.session.instructor_id,
        fname: req.session.fname,
        lname: req.session.lname,
        instructor_certificate_number: req.session.instructor_certificate_number,
        location: req.session.location,
        location_name: req.session.location_name || null,
        loggedinInstructor: req.session.loggedinInstructor || null,
      },
    });
  }

  async logout(req, res) {
    const sessionCookie = getInstructorSessionCookieOptions();

    if (!req.session) {
      res.clearCookie('instructor.sid', { path: sessionCookie.path });
      return res.json({ success: true, message: 'Logged out' });
    }

    req.session.destroy((err) => {
      if (err) {
        console.error('[INSTRUCTOR][AUTH][LOGOUT] Session destroy failed:', err.message);
      }
      res.clearCookie('instructor.sid', { path: sessionCookie.path });
      return res.json({ success: true, message: 'Logged out' });
    });
  }

  async branding(req, res) {
    try {
      const [rows] = await this.pool.query(
        'SELECT admin_logo_url FROM settings LIMIT 1'
      );
      const adminLogoUrl = rows && rows.length > 0 && rows[0].admin_logo_url ? rows[0].admin_logo_url : null;
      const legacyAdminBase = (process.env.LEGACY_ADMIN_URL || process.env.PHP_SITE_URL || '').replace(/\/$/, '');
      const logoUrl = adminLogoUrl && legacyAdminBase ? `${legacyAdminBase}/uploads/${adminLogoUrl}` : null;

      return res.json({
        success: true,
        data: {
          admin_logo_url: adminLogoUrl,
          logo_url: logoUrl,
        },
      });
    } catch (err) {
      console.error('[INSTRUCTOR][AUTH][BRANDING] Error:', err.message);
      return res.json({
        success: true,
        data: {
          admin_logo_url: null,
          logo_url: null,
        },
      });
    }
  }
}

module.exports = InstructorAuthController;
