/** Matches legacy admin/includes/config.php LOCK_EXPIRE_TIME */
const LOCK_EXPIRE_TIME_MINUTES = 20;

/** lock_bookings.locked_by after an admin Stripe payment link is sent. */
const STRIPE_PAYMENT_LINK_LOCKED_BY = 'Stripe_Payment_link';

function isStripePaymentLinkLockedBy(value) {
  return String(value || '').trim() === STRIPE_PAYMENT_LINK_LOCKED_BY;
}

module.exports = {
  LOCK_EXPIRE_TIME_MINUTES,
  STRIPE_PAYMENT_LINK_LOCKED_BY,
  isStripePaymentLinkLockedBy,
};
