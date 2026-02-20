// src/index.js
require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const createAuthRoutes = require('./routes/auth');
const createCourseRoutes = require('./routes/courses');
const createBookingRoutes = require('./routes/bookings');
const createDatabaseRoutes = require('./routes/database');
const createCMSRoutes = require('./routes/cms');
const createCMSPagesRoutes = require('./routes/cmspages');
const createHomepageRoutes = require('./routes/homepage');
const BookingStatusManager = require('./middleware/bookingStatusManager');
const createContactUsRoutes = require('./routes/contactus');
const createSearchRoutes = require('./routes/search');
const locationCourseRoutes = require('./routes/locationcourse');
const allLocationsRoutes = require('./routes/alllocation');
const pageMenuRoutes = require('./routes/pagemenu');
const dynamicDataRoutes = require('./routes/dynamicData');
const createPreBookingRoutes = require('./routes/preBooking');
const bookingFlowRoutes = require('./routes/bookingFlow');
const createHelperRoutes = require('./routes/helper');
const createPriceCalculationRoutes = require('./routes/priceCalculation');
const createWebhookRoutes = require('./routes/webhook');
const createManualPaymentRoutes = require('./routes/manualPayment');
const createDashboardRoutes = require('./routes/dashboard');
const createUserRoutes = require('./routes/user');
const createGiftVoucherRoutes = require('./routes/giftVoucher');
const createDebugVoucherRoutes = require('./routes/debugVoucher');
const createCheckAvailabilityRoutes = require('./routes/checkAvailability');
const createConfirmBookingRoutes = require('./routes/confirmBooking');
const PreBookingController = require('./controllers/preBooking');
const BookingCleanupCron = require('./cron/cleanupUnpaidBookings');
const app = express();

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

// IMPORTANT: Stripe webhook route MUST be registered BEFORE express.json() middleware
// because Stripe needs raw body for signature verification
const createStripeWebhookRoutes = require('./routes/stripeWebhook');
app.use('/api/webhook', createStripeWebhookRoutes(pool));

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// IP address extraction middleware (must be before CORS)
app.use((req, res, next) => {
  // Get real IP from various headers (for proxies, load balancers)
  req.clientIp = 
    req.headers['cf-connecting-ip'] || // Cloudflare
    req.headers['x-forwarded-for']?.split(',')[0].trim() || // Proxy chains
    req.headers['x-forwarded-for'] || // Standard proxy header
    req.socket.remoteAddress ||
    req.connection.remoteAddress ||
    req.ip ||
    'unknown';

  // Normalize IPv6 localhost to IPv4
  if (req.clientIp === '::1' || req.clientIp === '::ffff:127.0.0.1') {
    req.clientIp = '127.0.0.1';
  }
  
  // Clean IPv6 mapped IPv4 addresses (::ffff:192.168.1.1 → 192.168.1.1)
  if (req.clientIp.includes('::ffff:')) {
    req.clientIp = req.clientIp.replace('::ffff:', '');
  }

  next();
});

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
app.use('/api/cmspages', createCMSPagesRoutes(pool));
app.use('/api/homepage', createHomepageRoutes(pool));
app.use('/api/contactus', createContactUsRoutes(pool));
app.use('/api/search', createSearchRoutes(pool));
app.use('/api/location-course', locationCourseRoutes(pool));
app.use('/api/all-locations', allLocationsRoutes(pool));
app.use('/api/pagemenu', pageMenuRoutes(pool));
app.use('/api/get-data', dynamicDataRoutes(pool));
app.use('/api/booking', createPreBookingRoutes(pool));
app.use('/api/booking', bookingFlowRoutes(pool));
app.use('/api/booking-flow', bookingFlowRoutes(pool));
app.use('/api/helper', createHelperRoutes(pool));
app.use('/api/booking/pricing', createPriceCalculationRoutes(pool));
app.use('/api/webhook', createWebhookRoutes(pool));
app.use('/api/payment', createManualPaymentRoutes(pool));
app.use('/api/dashboard', createDashboardRoutes(pool));
app.use('/api/user', createUserRoutes(pool));
app.use('/api/vouchers', createGiftVoucherRoutes(pool));
app.use('/api/vouchers', createDebugVoucherRoutes(pool));
app.use('/api/booking', createCheckAvailabilityRoutes(pool));
app.use('/api/booking', createConfirmBookingRoutes(pool));

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
      },
      search: {
        'GET /api/search/suggestions': 'Get auto-suggest results (query param: q)',
        'GET /api/search': 'Full search with pagination (query params: q, type, page, limit)'
      },
      pricing: {
        'POST /api/booking/pricing/calculate': 'Calculate booking price with all business rules',
        'GET /api/booking/pricing/validate/:course_event_id': 'Validate course event for pricing',
        'GET /api/booking/pricing/options/:course_event_id': 'Get pricing options for course event'
      },
      dashboard: {
        'GET /api/dashboard': 'Get user dashboard data (requires token)'
      },
      user: {
        'GET /api/user/profile': 'Get user profile (requires token)',
        'PUT /api/user/profile': 'Update user profile (requires token)'
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
  console.log(`1Stop Instruction API server listening on http://localhost:${PORT}`);
  console.log(`API Documentation: http://localhost:${PORT}/api`);
  console.log(`Health Check: http://localhost:${PORT}/health`);
  console.log(`DB Test: http://localhost:${PORT}/db-test`);
  console.log(`Auth Endpoints: http://localhost:${PORT}/api/auth/*`);
  
  // Start booking cleanup job
  BookingStatusManager.startCleanupJob(pool);
  
  // Start unpaid bookings cleanup cron
  const cleanupCron = new BookingCleanupCron(pool);
  cleanupCron.start();
});
