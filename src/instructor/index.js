/**
 * Instructor API router mounted at /api/instructor
 *
 * Dedicated auth & session using independent cookie (name: instructor.sid).
 * Completely decoupled from admin session (connect.sid).
 */
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const createInstructorAuthRoutes = require('./routes/auth');
const createInstructorItineraryRoutes = require('./routes/itinerary');
const createInstructorDlReturnsRoutes = require('./routes/dlReturns');
const createInstructorVehiclesRoutes = require('./routes/vehicles');
const { getInstructorSessionCookieOptions } = require('./sessionCookie');

function createInstructorRoutes(pool) {
  const router = express.Router();
  const sessionCookie = getInstructorSessionCookieOptions();

  router.use(cookieParser());

  router.use(
    session({
      name: 'instructor.sid',
      secret:
        process.env.INSTRUCTOR_SESSION_SECRET ||
        process.env.SESSION_SECRET ||
        process.env.JWT_SECRET ||
        '1stop-instructor-session-secret-key-2026',
      resave: false,
      saveUninitialized: false,
      cookie: sessionCookie,
    })
  );

  router.use('/auth', createInstructorAuthRoutes(pool));
  router.use('/itinerary', createInstructorItineraryRoutes(pool));
  router.use('/dl-returns', createInstructorDlReturnsRoutes(pool));
  router.use('/vehicles', createInstructorVehiclesRoutes(pool));

  return router;
}

module.exports = createInstructorRoutes;
