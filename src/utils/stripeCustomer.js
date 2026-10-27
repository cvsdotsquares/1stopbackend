const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

/**
 * Find an existing Stripe Customer by email or create a new one.
 *
 * Keyed strictly by email so every unique email address gets its own Stripe
 * Customer ID instead of the dashboard grouping them under "Guest". Works
 * identically for logged-in and guest checkouts because it only relies on
 * the attendee email, name, and phone passed in.
 *
 * Order of operations:
 *   1. Try Stripe search (`stripe.customers.search`) by email.
 *   2. If that returns no result OR errors, create a new customer.
 *   3. If creation also fails, return null and let the caller proceed
 *      without a customer attached (payment must not be blocked by this
 *      lookup).
 *
 * @param {Object} params
 * @param {string} params.email
 * @param {string} [params.name]
 * @param {string} [params.phone]
 * @param {Object} [params.metadata] - Optional metadata attached on create
 * @returns {Promise<string|null>} Stripe customer id or null on total failure
 */
async function findOrCreateStripeCustomerByEmail({ email, name, phone, metadata } = {}) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return null;

  try {
    const escapedEmail = normalizedEmail.replace(/"/g, '\\"');
    const searchResult = await stripe.customers.search({
      query: `email:"${escapedEmail}"`,
      limit: 1
    });

    if (searchResult?.data?.length > 0) {
      return searchResult.data[0].id;
    }
  } catch (searchError) {
    // Stripe search has ~1 min eventual consistency and its own rate limits.
    // A search failure must not stop us from proceeding to create.
  }

  try {
    const customer = await stripe.customers.create({
      email: normalizedEmail,
      ...(name ? { name: String(name).trim().slice(0, 256) } : {}),
      ...(phone ? { phone: String(phone).trim().slice(0, 50) } : {}),
      ...(metadata ? { metadata } : {})
    });
    return customer?.id || null;
  } catch (createError) {
    console.error('Stripe customer create failed:', createError?.message || createError);
    return null;
  }
}

module.exports = {
  findOrCreateStripeCustomerByEmail
};
