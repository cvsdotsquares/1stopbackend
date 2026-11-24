const BookingCleanupCron = require('./cleanupUnpaidBookings');
const ExpiredLockCleanupCron = require('./cleanupExpiredLocks');
const StripeLinkExpiryCron = require('./cleanupExpiredStripeLinks');
const StripePaymentLinkLockExpiryCron = require('./cleanupExpiredStripePaymentLinkLocks');
const GoogleContactsSyncCron = require('./googleContactsSync');
const RecalculateLocksCron = require('./recalculateLocksCron');
const BlockIpsCron = require('./blockIpsCron');
const BookingConfirmationCron = require('./bookingConfirmationCron');
const AutomaticReminderCron = require('./automaticReminderCron');
const FeedbackEmailCron = require('./feedbackEmailCron');
const AutomatedEmailCron = require('./automatedEmailCron');
const VehicleStatusCron = require('./vehicleStatusCron');
const SyncAttendeeContactsCron = require('./syncAttendeeContactsCron');

/**
 * Resolves whether live-only crons should run.
 * Defaults to false (Staging mode).
 * Set ENABLE_LIVE_CRONS=true or APP_ENV=live to enable live customer comms & maintenance crons.
 */
function isLiveCronsEnabled() {
  const flag = String(
    process.env.ENABLE_LIVE_CRONS || process.env.LIVE_CRONS_ENABLED || ''
  ).trim().toLowerCase();

  if (flag === 'true' || flag === '1') return true;
  if (flag === 'false' || flag === '0') return false;

  const appEnv = String(
    process.env.APP_ENV || process.env.DEPLOY_ENV || ''
  ).trim().toLowerCase();

  return appEnv === 'live' || appEnv === 'prod' || appEnv === 'production_live';
}

/**
 * Initializes and starts all background jobs based on staging vs live environment.
 */
function startAllCrons(pool) {
  const liveMode = isLiveCronsEnabled();

  console.log('----------------------------------------------------');
  console.log(
    `[CRON SYSTEM] Mode: ${
      liveMode
        ? 'LIVE (All background jobs enabled)'
        : 'STAGING (Only staging crons active; live-only customer comms & vehicle status disabled)'
    }`
  );
  console.log('----------------------------------------------------');

  // --- Core / Front-end Infrastructure Crons (Always active) ---
  const cleanupCron = new BookingCleanupCron(pool);
  cleanupCron.start();

  const stripeLinkExpiryCron = new StripeLinkExpiryCron(pool);
  stripeLinkExpiryCron.start();

  const stripePaymentLinkLockExpiryCron = new StripePaymentLinkLockExpiryCron(pool);
  stripePaymentLinkLockExpiryCron.start();

  const googleContactsSyncCron = new GoogleContactsSyncCron(pool);
  googleContactsSyncCron.start();

  // --- Section E: Staging-Enabled Crons ---
  // 1. automatic_remove_space.php
  const expiredLockCleanupCron = new ExpiredLockCleanupCron(pool);
  expiredLockCleanupCron.start();
  console.log('[CRON ACTIVE] automatic_remove_space (ExpiredLockCleanupCron)');

  // 2. remove_current_lock.php
  const recalculateLocksCron = new RecalculateLocksCron(pool);
  recalculateLocksCron.start();
  console.log('[CRON ACTIVE] remove_current_lock (RecalculateLocksCron)');

  // 3. cron_block_ips.php
  const blockIpsCron = new BlockIpsCron(pool);
  blockIpsCron.start();
  console.log('[CRON ACTIVE] cron_block_ips (BlockIpsCron)');

  // 4. automatic_booking_confirmation.php
  const bookingConfirmationCron = new BookingConfirmationCron(pool);
  bookingConfirmationCron.start();
  console.log('[CRON ACTIVE] automatic_booking_confirmation (BookingConfirmationCron)');

  // --- Section E: Live-Only Crons (Disabled on Staging) ---
  // 5. automatic_reminder_cron.php
  if (liveMode || process.env.CRON_REMINDERS_ENABLED === 'true') {
    const automaticReminderCron = new AutomaticReminderCron(pool);
    automaticReminderCron.start();
    console.log('[CRON ACTIVE] automatic_reminder_cron (AutomaticReminderCron)');
  } else {
    console.log('[CRON DISABLED ON STAGING] automatic_reminder_cron (Live only)');
  }

  // 6. automated_email_cron.php
  if (liveMode || process.env.CRON_AUTOMATED_EMAILS_ENABLED === 'true') {
    const automatedEmailCron = new AutomatedEmailCron(pool);
    automatedEmailCron.start();
    console.log('[CRON ACTIVE] automated_email_cron (AutomatedEmailCron)');
  } else {
    console.log('[CRON DISABLED ON STAGING] automated_email_cron (Live only)');
  }

  // 7. itinary_feedback_email_cron.php
  if (liveMode || process.env.CRON_FEEDBACK_EMAILS_ENABLED === 'true') {
    const feedbackEmailCron = new FeedbackEmailCron(pool);
    feedbackEmailCron.start();
    console.log('[CRON ACTIVE] itinary_feedback_email_cron (FeedbackEmailCron)');
  } else {
    console.log('[CRON DISABLED ON STAGING] itinary_feedback_email_cron (Live only)');
  }

  // 8. vehicle_update_status_cron.php
  if (liveMode || process.env.CRON_VEHICLE_STATUS_ENABLED === 'true') {
    const vehicleStatusCron = new VehicleStatusCron(pool);
    vehicleStatusCron.start();
    console.log('[CRON ACTIVE] vehicle_update_status_cron (VehicleStatusCron)');
  } else {
    console.log('[CRON DISABLED ON STAGING] vehicle_update_status_cron (Live only)');
  }

  // 9. sync_attendee_contacts.php
  if (liveMode || process.env.CRON_SYNC_CONTACTS_ENABLED === 'true') {
    const syncAttendeeContactsCron = new SyncAttendeeContactsCron(pool);
    syncAttendeeContactsCron.start();
    console.log('[CRON ACTIVE] sync_attendee_contacts (SyncAttendeeContactsCron)');
  } else {
    console.log('[CRON DISABLED ON STAGING] sync_attendee_contacts (Live only)');
  }
}

module.exports = {
  isLiveCronsEnabled,
  startAllCrons,
};
