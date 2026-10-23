function getInstructorSessionCookieOptions() {
  const secure = process.env.INSTRUCTOR_COOKIE_SECURE === 'true' || process.env.ADMIN_COOKIE_SECURE === 'true';
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: '/',
  };
}

module.exports = { getInstructorSessionCookieOptions };
