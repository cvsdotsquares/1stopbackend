// src/index.js
require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const { getClientIp, getTrustProxySetting } = require('./utils/clientIp');
const createAuthRoutes = require('./routes/auth');
const createCourseRoutes = require('./routes/courses');
const createBookingRoutes = require('./routes/bookings');
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
// const createManualPaymentRoutes = require('./routes/manualPayment');
const createDashboardRoutes = require('./routes/dashboard');
const createUserRoutes = require('./routes/user');
const createAttendeeRoutes = require('./routes/attendee');
const createGiftVoucherRoutes = require('./routes/giftVoucher');
const createDebugVoucherRoutes = require('./routes/debugVoucher');
const createCheckAvailabilityRoutes = require('./routes/checkAvailability');
const createConfirmBookingRoutes = require('./routes/confirmBooking');
const createGetcourseRoutes = require('./routes/getcourse');
const createHoldSpaceRoutes = require('./routes/holdSpace');
const createRemoveSpaceRoutes = require('./routes/removeSpace');
const createFAQRoutes = require('./routes/faq');
const PreBookingController = require('./controllers/preBooking');
const BookingCleanupCron = require('./cron/cleanupUnpaidBookings');
const ExpiredLockCleanupCron = require('./cron/cleanupExpiredLocks');
const GoogleContactsSyncCron = require('./cron/googleContactsSync');
const app = express();
app.set('trust proxy', getTrustProxySetting());
console.log('[SECURITY] trust proxy', process.env.TRUST_PROXY || 'loopback/private/Cloudflare only');

// MySQL pool (uses env vars)
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
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
  req.clientIp = getClientIp(req);
  next();
});

// CORS headers
// Allow-Headers MUST list every non-standard request header the frontend sends
// (Authorization is standard, but X-Requested-With is not, so without it the
// browser blocks the preflight). Origin pinning lets us flip on credentialed
// requests (cookies/Authorization with credentials:'include') without breaking,
// since `Access-Control-Allow-Origin: *` is incompatible with
// `Access-Control-Allow-Credentials: true`.
const corsAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const requestOrigin = req.headers.origin;
  if (corsAllowedOrigins.length === 0) {
    // No allowlist configured → fall back to the existing permissive behaviour.
    res.header('Access-Control-Allow-Origin', '*');
  } else if (requestOrigin && corsAllowedOrigins.includes(requestOrigin)) {
    res.header('Access-Control-Allow-Origin', requestOrigin);
    res.header('Vary', 'Origin');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization'
  );
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
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

// NOTE: BookingStatusManager.createStatusUpdateMiddleware is intentionally
// NOT mounted. Its previous implementation auto-rewrote `bookings.status`
// (e.g. flipping confirmed->2 for "completed") which collided with the
// legacy PHP REFUNDED:2 semantics and made bookings disappear from admin
// lists. Status mutations are now driven only by explicit business actions
// (payment success, refund, move) and by the dedicated cleanup crons.

// API Routes
app.use('/api/auth', createAuthRoutes(pool));
app.use('/api/courses', createCourseRoutes(pool));
app.use('/api/bookings', createBookingRoutes(pool));
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
// app.use('/api/payment', createManualPaymentRoutes(pool));
app.use('/api/dashboard', createDashboardRoutes(pool));
app.use('/api/user', createUserRoutes(pool));
app.use('/api/attendee', createAttendeeRoutes(pool));
app.use('/api/vouchers', createGiftVoucherRoutes(pool));
app.use('/api/vouchers', createDebugVoucherRoutes(pool));
app.use('/restapi/booking', createCheckAvailabilityRoutes(pool));
app.use('/restapi/booking', createConfirmBookingRoutes(pool));
app.use('/restapi/booking', createGetcourseRoutes(pool));
app.use('/restapi/booking', createHoldSpaceRoutes(pool));
app.use('/restapi/booking', createRemoveSpaceRoutes(pool));
app.use('/api/faq', createFAQRoutes(pool));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`1Stop Instruction API server listening on http://localhost:${PORT}`);
  console.log(`Health Check: http://localhost:${PORT}/health`);
  console.log(`DB Test: http://localhost:${PORT}/db-test`);
  console.log(`Auth Endpoints: http://localhost:${PORT}/api/auth/*`);

  // NOTE: BookingStatusManager.startCleanupJob is intentionally not invoked.
  // It previously auto-wrote status=2 (confused with PHP REFUNDED) and
  // status=3 (a value PHP does not understand) which corrupted live data.
  // Unpaid-booking expiry is owned by BookingCleanupCron below; lock expiry
  // is owned by ExpiredLockCleanupCron.

  // Start unpaid bookings cleanup cron
  const cleanupCron = new BookingCleanupCron(pool);
  cleanupCron.start();

  // Start expired lock cleanup cron
  const expiredLockCleanupCron = new ExpiredLockCleanupCron(pool);
  expiredLockCleanupCron.start();

  // Start Google contacts sync cron
  const googleContactsSyncCron = new GoogleContactsSyncCron(pool);
  googleContactsSyncCron.start();
});
