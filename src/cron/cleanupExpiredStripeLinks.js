const cron = require('node-cron');
const {
  expireDueAdminStripePaymentLinks,
} = require('../admin/services/bookingStripeLinkService');

class StripeLinkExpiryCron {
  constructor(pool) {
    this.pool = pool;
  }

  async run() {
    try {
      const result = await expireDueAdminStripePaymentLinks(this.pool);
      if (result?.expired) {
        console.log(
          `[STRIPE LINK CRON] Expired ${result.expired} unpaid admin Stripe payment link(s)`
        );
      }
    } catch (error) {
      console.error('[STRIPE LINK CRON] Error expiring payment links:', error);
    }
  }

  start() {
    cron.schedule('* * * * *', () => {
      this.run();
    });
    console.log(
      `[STRIPE LINK CRON] Scheduled every minute (expires with remaining reservation time)`
    );
  }
}

module.exports = StripeLinkExpiryCron;
