/**
 * Stripe payment methods offered on the public booking checkout.
 *
 * Card covers Apple Pay / Google Pay wallets in Payment Element / Express Checkout.
 * Pay by Bank (`pay_by_bank`) is open-banking and redirects the customer to
 * their bank, so it finishes within a checkout session.
 *
 * Bank transfer (`customer_balance`) is deliberately NOT offered: funds take
 * 1-3 working days to arrive, which cannot hold a course seat.
 *
 * `automatic_payment_methods` cannot be combined with `payment_method_types`.
 */

const BOOKING_PAYMENT_METHOD_TYPES = ['card', 'link', 'pay_by_bank'];

function buildBookingPaymentIntentParams({
  amount,
  currency = 'gbp',
  customer,
  metadata,
  description,
  receiptEmail,
} = {}) {
  const params = {
    amount,
    currency,
    payment_method_types: [...BOOKING_PAYMENT_METHOD_TYPES],
    metadata,
    description,
    receipt_email: receiptEmail,
  };

  if (customer) {
    params.customer = customer;
  }

  return params;
}

async function createBookingPaymentIntent(stripe, args) {
  const params = buildBookingPaymentIntentParams(args);
  try {
    return await stripe.paymentIntents.create(params);
  } catch (firstError) {
    // Account may not have Pay by Bank activated yet. Fall back so card and
    // wallet checkout is not blocked.
    console.error(
      'Stripe PI with Pay by Bank failed, falling back to automatic methods:',
      firstError?.message || firstError
    );
    return stripe.paymentIntents.create({
      amount: args.amount,
      currency: args.currency || 'gbp',
      automatic_payment_methods: { enabled: true },
      ...(args.customer ? { customer: args.customer } : {}),
      metadata: args.metadata,
      description: args.description,
      receipt_email: args.receiptEmail,
    });
  }
}

module.exports = {
  BOOKING_PAYMENT_METHOD_TYPES,
  buildBookingPaymentIntentParams,
  createBookingPaymentIntent,
};
