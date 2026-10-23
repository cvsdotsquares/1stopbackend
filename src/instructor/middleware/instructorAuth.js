/**
 * Require an authenticated instructor session (legacy PHP $_SESSION['instructor'] equivalent).
 */
function requireInstructorSession(req, res, next) {
  if (!req.session || !req.session.instructor || !req.session.instructor_id) {
    return res.status(401).json({
      success: false,
      message: 'Instructor session required',
    });
  }
  next();
}

/**
 * Strip pass from instructor record before sending to client.
 */
function sanitizeLoggedInInstructor(instructorRow) {
  if (!instructorRow || typeof instructorRow !== 'object') {
    return instructorRow;
  }
  const { pass: _pass, ...safe } = instructorRow;
  return safe;
}

module.exports = { requireInstructorSession, sanitizeLoggedInInstructor };
