function getAdminSessionCookieOptions() {
  const secure = process.env.ADMIN_COOKIE_SECURE === 'true';
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000,
    path: '/',
  };
}

module.exports = { getAdminSessionCookieOptions };
