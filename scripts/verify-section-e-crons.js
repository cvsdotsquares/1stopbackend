require('../src/loadEnv');
const mysql = require('mysql2/promise');

const ExpiredLockCleanupCron = require('../src/cron/cleanupExpiredLocks');
const RecalculateLocksCron = require('../src/cron/recalculateLocksCron');
const BlockIpsCron = require('../src/cron/blockIpsCron');
const BookingConfirmationCron = require('../src/cron/bookingConfirmationCron');
const AutomaticReminderCron = require('../src/cron/automaticReminderCron');
const FeedbackEmailCron = require('../src/cron/feedbackEmailCron');
const AutomatedEmailCron = require('../src/cron/automatedEmailCron');
const VehicleStatusCron = require('../src/cron/vehicleStatusCron');
const SyncAttendeeContactsCron = require('../src/cron/syncAttendeeContactsCron');

async function main() {
  console.log('=== Section E Background Jobs Smoke Verification ===\n');

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
  });

  try {
    // 1. Lock Cleanup
    console.log('[TEST 1/9] Testing ExpiredLockCleanupCron...');
    const lockCron = new ExpiredLockCleanupCron(pool);
    await lockCron.cleanupExpiredLocks();
    console.log('✓ ExpiredLockCleanupCron ran successfully\n');

    // 2. Recalculate Locks
    console.log('[TEST 2/9] Testing RecalculateLocksCron...');
    const recalcCron = new RecalculateLocksCron(pool);
    await recalcCron.recalculateLocks();
    console.log('✓ RecalculateLocksCron ran successfully\n');

    // 3. Block IPs
    console.log('[TEST 3/9] Testing BlockIpsCron...');
    const blockIps = new BlockIpsCron(pool);
    await blockIps.processBlockedIps();
    console.log('✓ BlockIpsCron ran successfully\n');

    // 4. Booking Confirmation
    console.log('[TEST 4/9] Testing BookingConfirmationCron...');
    const confirmCron = new BookingConfirmationCron(pool);
    await confirmCron.processPendingConfirmations();
    console.log('✓ BookingConfirmationCron ran successfully\n');

    // 5. Automatic Reminder
    console.log('[TEST 5/9] Testing AutomaticReminderCron...');
    const reminderCron = new AutomaticReminderCron(pool);
    await reminderCron.sendReminders();
    console.log('✓ AutomaticReminderCron ran successfully\n');

    // 6. Feedback Email
    console.log('[TEST 6/9] Testing FeedbackEmailCron...');
    const feedbackCron = new FeedbackEmailCron(pool);
    await feedbackCron.sendDailyPassedFeedbackEmails();
    console.log('✓ FeedbackEmailCron ran successfully\n');

    // 7. Automated Email
    console.log('[TEST 7/9] Testing AutomatedEmailCron...');
    const autoEmailCron = new AutomatedEmailCron(pool);
    await autoEmailCron.processAutomatedEmails();
    console.log('✓ AutomatedEmailCron ran successfully\n');

    // 8. Vehicle Status
    console.log('[TEST 8/9] Testing VehicleStatusCron...');
    const vehicleCron = new VehicleStatusCron(pool);
    await vehicleCron.updateVehicleStatuses();
    console.log('✓ VehicleStatusCron ran successfully\n');

    // 9. Sync Attendee Contacts
    console.log('[TEST 9/9] Testing SyncAttendeeContactsCron...');
    const syncCron = new SyncAttendeeContactsCron(pool);
    await syncCron.syncAttendeeContacts();
    console.log('✓ SyncAttendeeContactsCron ran successfully\n');

    console.log('====================================================');
    console.log('ALL SECTION E BACKGROUND JOBS VERIFIED SUCCESSFULLY!');
    console.log('====================================================');
  } catch (err) {
    console.error('Smoke verification failed:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
