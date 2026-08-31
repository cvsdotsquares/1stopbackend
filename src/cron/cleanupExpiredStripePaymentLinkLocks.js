const cron = require('node-cron');
const {
  expireDueStripePaymentLinkLocks,
} = require('../admin/services/bookingStripeLinkService');

/**
 * Deletes lock_bookings rows tagged Stripe_Payment_link once 20 minutes have
 * passed since the payment link was created (created is reset at send time).
 * Also expires the unpaid Stripe checkout session and pending bookings.
 */
class StripePaymentLinkLockExpiryCron {
  constructor(pool) {
    this.pool = pool;
  }

  async run() {
    try {
      const result = await expireDueStripePaymentLinkLocks(this.pool);
      if (result?.deleted) {
        console.log(
          `[STRIPE LINK LOCK CRON] Deleted ${result.deleted} expired Stripe payment-link lock(s)`
        );
      }
    } catch (error) {
      console.error(
        '[STRIPE LINK LOCK CRON] Error deleting expired Stripe payment-link locks:',
        error
      );
    }
  }

  start() {
    cron.schedule('* * * * *', () => {
      this.run();
    });
    console.log(
      '[STRIPE LINK LOCK CRON] Scheduled every minute (deletes lock_bookings 20 minutes after payment link creation)'
    );
  }
}

module.exports = StripePaymentLinkLockExpiryCron;
