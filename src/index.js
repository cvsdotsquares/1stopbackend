// src/index.js
require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const createAuthRoutes = require('./routes/auth');
const createCourseRoutes = require('./routes/courses');
const createBookingRoutes = require('./routes/bookings');
const createDatabaseRoutes = require('./routes/database');
const createCMSRoutes = require('./routes/cms');
const createHomepageRoutes = require('./routes/homepage');
const BookingStatusManager = require('./middleware/bookingStatusManager');
const createContactUsRoutes = require('./routes/contactus');
const searchRoutes = require('./routes/search');
const locationCourseRoutes = require('./routes/locationcourse');
const pageMenuRoutes = require('./routes/pagemenu');


const app = express();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS headers (basic setup - customize for production)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// MySQL pool (uses env vars)
/* const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});*/

const pool = mysql.createPool({
    host: '172.236.21.167',
    port: 3306,
    user: '1stop',
    password: 'Gbgz&En4Wg&HmFJTFf',
    database: '1stop',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});


// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
  });
});

// DB connection test
app.get('/db-test', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 AS result');
    res.json({
      db: 'connected',
      result: rows[0],
    });
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({
      db: 'error',
      message: err.message,
    });
  }
});

// Booking status management middleware (runs before routes)
app.use(BookingStatusManager.createStatusUpdateMiddleware(pool));

// API Routes
app.use('/api/auth', createAuthRoutes(pool));
app.use('/api/courses', createCourseRoutes(pool));
app.use('/api/bookings', createBookingRoutes(pool));
app.use('/api/database', createDatabaseRoutes(pool));
app.use('/api/cms', createCMSRoutes(pool));
app.use('/api/homepage', createHomepageRoutes(pool));
app.use('/api/contactus', createContactUsRoutes(pool));
app.use('/api/search', searchRoutes(pool));
app.use('/api/location-course', locationCourseRoutes(pool));
app.use('/api/pagemenu', pageMenuRoutes(pool));

// API Documentation endpoint
app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: '1Stop Instruction API',
    version: '1.0.0',
    endpoints: {
      auth: {
        'POST /api/auth/register': 'Register new user',
        'POST /api/auth/login': 'Login user',
        'GET /api/auth/profile': 'Get user profile (requires token)',
        'PUT /api/auth/profile': 'Update user profile (requires token)',
        'POST /api/auth/change-password': 'Change password (requires token)',
        'GET /api/auth/verify': 'Verify token (requires token)'
      },
      courses: {
        'GET /api/courses': 'List all courses',
        'GET /api/courses/featured': 'Get featured courses',
        'GET /api/courses/search': 'Search courses with filters',
        'GET /api/courses/:id': 'Get course details by ID',
        'GET /api/courses/:id/stats': 'Get course statistics (requires token)'
      },
      locations: {
        'GET /api/courses/locations/all': 'List all locations',
        'GET /api/courses/locations/with-courses': 'Get locations with available courses',
        'GET /api/courses/locations/nearest': 'Find nearest locations',
        'GET /api/courses/locations/:id': 'Get location details by ID',
        'GET /api/courses/locations/stats': 'Get location statistics (requires token)'
      },
      events: {
        'GET /api/courses/events/all': 'List course events/schedules',
        'GET /api/courses/events/available-dates': 'Get available dates for booking',
        'GET /api/courses/events/calendar': 'Get event calendar',
        'GET /api/courses/events/check-availability': 'Check specific event availability',
        'GET /api/courses/events/:id': 'Get event details by ID'
      },
      bookings: {
        'POST /api/bookings': 'Create a new booking (requires token)',
        'GET /api/bookings': 'Get user bookings with pagination (requires token)',
        'GET /api/bookings/stats': 'Get user booking statistics (requires token)',
        'GET /api/bookings/:id': 'Get booking details by ID (requires token)',
        'PUT /api/bookings/:id': 'Update booking details (requires token)',
        'POST /api/bookings/:id/cancel': 'Cancel a booking (requires token)',
        'GET /api/bookings/admin/all': 'Get all bookings - admin only (requires admin token)',
        'PUT /api/bookings/admin/:id/status': 'Update booking status - admin only (requires admin token)',
        'GET /api/bookings/admin/statistics': 'Get booking statistics - admin only (requires admin token)'
      },
      homepage: {
        'GET /api/homepage': 'Get homepage content from existing database tables'
      },
      cms: {
        'GET /api/cms/pages': 'Get all pages with pagination and filtering',
        'GET /api/cms/pages/:identifier': 'Get page by ID or slug',
        'POST /api/cms/pages': 'Create new page (requires admin token)',
        'PUT /api/cms/pages/:id': 'Update page (requires admin token)',
        'DELETE /api/cms/pages/:id': 'Delete page (requires admin token)',
        'GET /api/cms/testimonials': 'Get testimonials with pagination',
        'POST /api/cms/testimonials': 'Create testimonial (public but requires moderation)',
        'GET /api/cms/faqs': 'Get FAQs with categories',
        'GET /api/cms/carousels': 'Get carousel/slider images',
        'GET /api/cms/settings': 'Get site settings and configuration',
        'GET /api/cms/menu': 'Get page hierarchy for navigation menu'
      },
      cms_admin: {
        'GET /api/cms/admin/dashboard': 'Get CMS dashboard statistics (requires admin token)',
        'PUT /api/cms/admin/pages/bulk-update': 'Bulk update multiple pages (requires admin token)',
        'PUT /api/cms/admin/testimonials/:id/status': 'Approve/reject testimonials (requires admin token)',
        'POST /api/cms/admin/faqs': 'Create new FAQ (requires admin token)',
        'PUT /api/cms/admin/faqs/:id': 'Update FAQ (requires admin token)',
        'POST /api/cms/admin/carousels': 'Create carousel item (requires admin token)',
        'PUT /api/cms/admin/carousels/:id': 'Update carousel item (requires admin token)',
        'PUT /api/cms/admin/settings': 'Update site settings (requires admin token)',
        'GET /api/cms/admin/search': 'Global CMS content search (requires admin token)',
        'GET /api/cms/admin/export': 'Export CMS content backup (requires admin token)'
      },
      system: {
        'GET /health': 'Health check',
        'GET /db-test': 'Database connection test'
      },
      contactus: {
        'GET /api/contactus': 'Get contact us content from existing database tables',
        'POST /api/contactus': 'Create a new contact us entry in the database'
      }
    },
    authentication: {
      type: 'Bearer Token',
      header: 'Authorization: Bearer <token>',
      note: 'Get token from /api/auth/login endpoint'
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 1Stop Instruction API server listening on http://localhost:${PORT}`);
  console.log(`📋 API Documentation: http://localhost:${PORT}/api`);
  console.log(`🏥 Health Check: http://localhost:${PORT}/health`);
  console.log(`🔧 DB Test: http://localhost:${PORT}/db-test`);
  console.log(`🔐 Auth Endpoints: http://localhost:${PORT}/api/auth/*`);
});
