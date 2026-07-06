/**
 * Admin API router mounted at /api/admin
 *
 * Auth choice: httpOnly session cookie via express-session (name: connect.sid),
 * equivalent to PHP $_SESSION. The Next.js frontend must send
 * `credentials: 'include'` on all admin API requests so the cookie is sent
 * cross-origin when CORS_ALLOWED_ORIGINS includes the frontend origin.
 */
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const createAdminAuthRoutes = require('./routes/auth');
const createDashboardRoutes = require('./routes/dashboard');
const createHeaderRoutes = require('./routes/header');
const createLocationsRoutes = require('./routes/locations');
const createCoursesRoutes = require('./routes/courses');
const createFranchisesRoutes = require('./routes/franchises');
const createBookingsRoutes = require('./routes/bookings');
const { getAdminSessionCookieOptions } = require('./sessionCookie');

function createAdminRoutes(pool) {
  const router = express.Router();
  const sessionCookie = getAdminSessionCookieOptions();

  router.use(cookieParser());

  router.use(
    session({
      name: 'connect.sid',
      secret: process.env.SESSION_SECRET || process.env.JWT_SECRET || 'change-me-in-production',
      resave: false,
      saveUninitialized: false,
      cookie: sessionCookie,
    })
  );

  router.use('/auth', createAdminAuthRoutes(pool));
  router.use('/dashboard', createDashboardRoutes(pool));
  router.use('/header', createHeaderRoutes(pool));
  router.use('/locations', createLocationsRoutes(pool));
  router.use('/courses', createCoursesRoutes(pool));
  router.use('/franchises', createFranchisesRoutes(pool));
  router.use('/bookings', createBookingsRoutes(pool));

  return router;
}

module.exports = createAdminRoutes;
