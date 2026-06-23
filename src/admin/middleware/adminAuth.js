/**
 * Require an authenticated admin session (PHP $_SESSION['admin'] equivalent).
 */
function requireAdminSession(req, res, next) {
  if (!req.session || !req.session.admin) {
    return res.status(401).json({
      success: false,
      message: 'Admin session required',
    });
  }
  next();
}

/**
 * Strip admin_pass from loggedinAdmin before sending to client.
 */
function sanitizeLoggedInAdmin(loggedinAdmin) {
  if (!loggedinAdmin || typeof loggedinAdmin !== 'object') {
    return loggedinAdmin;
  }
  const { admin_pass: _adminPass, ...safe } = loggedinAdmin;
  return safe;
}

module.exports = { requireAdminSession, sanitizeLoggedInAdmin };
