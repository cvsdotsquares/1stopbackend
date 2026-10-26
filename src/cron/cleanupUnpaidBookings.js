// src/cron/cleanupUnpaidBookings.js
//
// Periodic cleanup for abandoned `status = 0` (pending payment) booking
// rows. Mirrors the legacy PHP delete flow in
// 1stop-php/admin/booking_refund_delete_common.php:
//   - hard-DELETE from `bookings`
//   - hard-DELETE from `booking_attendees` (and `booking_attendees_dropdown`)
//   - soft-delete `booking_payments` (isDelete = 1)
//   - INSERT a serialized snapshot into `deleted_bookings`
//   - INSERT an audit row into `booking_update_history`
//   - release the held seats on `course_events.current_locks`
//
// Note: we deliberately DO NOT scan for `status = 3`. The previous
// implementation queried `(status = 0 OR status = 3)` because an earlier
// version of bookingStatusManager auto-wrote `status = 3` for "cancelled".
// That value is not part of the legacy schema and is no longer produced
// anywhere in this code base.
const cron = require('node-cron');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { isCourseEventFrozen } = require('../utils/courseEventGroup');
const { archiveAndDeleteBooking } = require('../utils/archiveBooking');
const StripeWebhookController = require('../controllers/stripeWebhook');
const { getCurrentMysqlDateTime } = require('../utils/dateFormat');

// Money is already moving — do not cancel or delete; wait for succeeded/failed.
const PROCESSING_PI_STATUSES = new Set(['processing', 'requires_capture']);

// Still collectable. Pay by Bank QR / client_secret stay valid in these states
// until the PaymentIntent is cancelled.
const CANCELABLE_PI_STATUSES = new Set([
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
]);

// Pay by Bank keeps its seat only for BOOKING_TIMEOUT_MINUTES, unlike cards
// which are deferred while in flight (3DS). It waits on the customer's banking
// app, so without a cancel the QR can still take payment after we delete.
const BANK_PAYMENT_METHOD_TYPES = new Set(['pay_by_bank']);

/**
 * Which payment method the customer actually chose. Our PaymentIntents are
 * created with several allowed types, so `payment_method_types` alone cannot
 * answer this — only the attached PaymentMethod (or next_action) can.
 */
async function resolveChosenPaymentMethodType(paymentIntent) {
  const paymentMethod = paymentIntent?.payment_method;
  if (!paymentMethod) return null;
  if (typeof paymentMethod === 'object') return paymentMethod.type || null;

  try {
    const method = await stripe.paymentMethods.retrieve(paymentMethod);
    return method?.type || null;
  } catch (error) {
    console.error(
      `[CLEANUP CRON] Could not resolve payment method ${paymentMethod}:`,
      error.message
    );
    return null;
  }
}

function isPayByBankIntent(paymentIntent, methodType) {
  if (BANK_PAYMENT_METHOD_TYPES.has(methodType)) return true;
  const nextType = String(paymentIntent?.next_action?.type || '');
  return nextType.includes('pay_by_bank');
}

async function cancelPaymentIntentOrExplain(paymentIntent) {
  try {
    const canceled = await stripe.paymentIntents.cancel(paymentIntent.id, {
      cancellation_reason: 'abandoned',
    });
    return { outcome: 'canceled', paymentIntent: canceled };
  } catch (cancelError) {
    let fresh = paymentIntent;
    try {
      fresh = await stripe.paymentIntents.retrieve(paymentIntent.id);
    } catch (_) {
      // keep last known object
    }
    if (fresh.status === 'succeeded') {
      return { outcome: 'succeeded', paymentIntent: fresh };
    }
    if (fresh.status === 'canceled') {
      return { outcome: 'canceled', paymentIntent: fresh };
    }
    if (fresh.status === 'processing') {
      return { outcome: 'processing', paymentIntent: fresh, error: cancelError };
    }
    return { outcome: 'failed', paymentIntent: fresh, error: cancelError };
  }
}

class BookingCleanupCron {
  constructor(pool) {
    this.pool = pool;
    // Reuses the existing webhook handler so a "missed webhook" booking is
    // healed by the exact same code path the webhook itself would run —
    // including its idempotency guard against double-processing.
    this.webhookController = new StripeWebhookController(pool);
  }

  /**
   * Stripe safety net. Before deleting a `status = 0` booking, look up its
   * PaymentIntent on Stripe (matched via PI.metadata.booking_id, which
   * bookingFlow.js stamps at PI creation time).
   *
   * Returns one of:
   *   { action: 'recover', paymentIntent }  → caller should replay webhook + skip delete
   *   { action: 'defer' }                   → caller should skip delete this round
   *   { action: 'delete' }                  → caller should proceed with delete
   *
   * On any Stripe error we return 'defer' — the cron must NEVER delete a
   * booking just because Stripe is briefly unreachable.
   */
  async _stripeSafetyCheck(booking, { frozen = false } = {}) {
    try {
      const search = await stripe.paymentIntents.search({
        query: `metadata['booking_id']:'${booking.id}'`,
        limit: 10,
        expand: ['data.payment_method'],
      });
      const intents = search.data || [];

      const succeeded = intents.find((p) => p.status === 'succeeded');
      if (succeeded) {
        return { action: 'recover', paymentIntent: succeeded };
      }

      const processing = intents.find((p) => PROCESSING_PI_STATUSES.has(p.status));
      if (processing) {
        return { action: 'defer', paymentIntent: processing };
      }

      // Card 3DS (and similar) stays deferred. Pay by Bank / unknown
      // requires_action is cancelled below so the QR cannot outlive the seat.
      // A frozen course cancels everything: the course is not running, so no
      // payment method should be left able to complete.
      if (!frozen) {
        for (const pi of intents) {
          if (pi.status !== 'requires_action' && pi.status !== 'requires_confirmation') {
            continue;
          }
          const methodType = await resolveChosenPaymentMethodType(pi);
          if (methodType && !isPayByBankIntent(pi, methodType)) {
            return { action: 'defer', paymentIntent: pi };
          }
        }
      }

      let last = intents[0] || null;
      for (const pi of intents) {
        if (!CANCELABLE_PI_STATUSES.has(pi.status)) continue;

        const methodType = await resolveChosenPaymentMethodType(pi);
        console.log(
          `[CLEANUP CRON] Booking ${booking.id}: cancelling PaymentIntent ${pi.id} ` +
          `(status=${pi.status}, method=${methodType || 'unknown'}) before releasing the seat`
        );

        const result = await cancelPaymentIntentOrExplain(pi);
        last = result.paymentIntent || pi;

        if (result.outcome === 'succeeded') {
          return { action: 'recover', paymentIntent: result.paymentIntent };
        }
        if (result.outcome === 'processing' || result.outcome === 'failed') {
          console.error(
            `[CLEANUP CRON] Failed to cancel PaymentIntent ${pi.id}; deferring to keep ` +
            `the seat rather than risk taking payment for a released booking:`,
            result.error?.message || result.outcome
          );
          return { action: 'defer', paymentIntent: result.paymentIntent };
        }

        console.log(
          `[CLEANUP CRON] Booking ${booking.id}: cancelled unpaid ` +
          `${methodType || pi.status} PaymentIntent ${pi.id}`
        );
      }

      return { action: 'delete', paymentIntent: last };
    } catch (error) {
      console.error(
        `[CLEANUP CRON] Stripe lookup failed for booking ${booking.id}; deferring delete to be safe:`,
        error.message
      );
      return { action: 'defer' };
    }
  }

  async cleanupUnpaidBookings() {
    const connection = await this.pool.getConnection();

    try {
      console.log('[CLEANUP CRON] Starting cleanup of unpaid bookings...');

      const timeoutMinutes = process.env.BOOKING_TIMEOUT_MINUTES || 30;
      const cleanupAt = getCurrentMysqlDateTime();
      // ORDER BY id ASC is load-bearing: bookingFlow.js inserts the primary
      // attendee's booking first, so it gets the lowest id in a submission.
      // Processing primary first lets a single handlePaymentSuccess replay
      // flip the whole submission to status=1 in one shot — then the
      // freshness re-read at the top of each iteration skips the secondaries.
      const [unpaidBookings] = await connection.query(`
        SELECT b.*
        FROM bookings b
        WHERE b.status = 0
          AND b.admin_payment_received = 0
          AND b.booking_made_by != 'admin'
          AND NOT (b.booking_made_by = 'moto' AND b.type_of_book = 'm')
          AND b.created < DATE_SUB(?, INTERVAL ? MINUTE)
        ORDER BY b.id ASC
      `, [cleanupAt, timeoutMinutes]);

      // Frozen courses are swept regardless of age: the admin has stopped the
      // course running, so an in-flight Pay by Bank QR must die now rather
      // than at the end of its normal hold.
      const [frozenBookings] = await connection.query(`
        SELECT DISTINCT b.*
        FROM bookings b
        LEFT JOIN freeze f ON f.course_event_id = b.course_event_id
        LEFT JOIN course_event_dates ced
          ON ced.course_event_id = b.course_event_id AND ced.freeze = 1
        WHERE b.status = 0
          AND b.admin_payment_received = 0
          AND (f.id IS NOT NULL OR ced.id IS NOT NULL)
        ORDER BY b.id ASC
      `);

      const candidates = [...unpaidBookings];
      const seenIds = new Set(unpaidBookings.map((b) => Number(b.id)));
      for (const booking of frozenBookings) {
        if (!seenIds.has(Number(booking.id))) {
          seenIds.add(Number(booking.id));
          candidates.push(booking);
        }
      }

      if (candidates.length === 0) {
        console.log('[CLEANUP CRON] No unpaid bookings to clean up');
        return;
      }

      console.log(
        `[CLEANUP CRON] Found ${candidates.length} unpaid bookings to clean up ` +
        `(${frozenBookings.length} on frozen courses)`
      );

      for (const candidate of candidates) {
        // Freshness re-read. A previous iteration's webhook replay may have
        // already flipped this row (multi-attendee submissions share one
        // PaymentIntent, so the primary's replay updates every sibling).
        const [freshRows] = await this.pool.query(
          `SELECT * FROM bookings
           WHERE id = ? AND status = 0 AND admin_payment_received = 0`,
          [candidate.id]
        );
        if (freshRows.length === 0) {
          console.log(`[CLEANUP CRON] Booking ${candidate.id} no longer needs cleanup (status or payment changed); skipping`);
          continue;
        }
        const booking = freshRows[0];
        const frozen = booking.course_event_id
          ? await isCourseEventFrozen(this.pool, booking.course_event_id)
          : false;

        if (frozen) {
          console.log(
            `[CLEANUP CRON] Booking ${booking.id} is on frozen course event ` +
            `${booking.course_event_id}; cancelling any open payment and releasing the seat`
          );
        }

        // Stripe safety net — only for the regular booking flow.
        // gift_voucher rows use different metadata (`bid`, `type`) and are
        // intentionally left on the legacy delete path for this minimal fix.
        if (booking.booking_made_by !== 'gift_voucher') {
          const check = await this._stripeSafetyCheck(booking, { frozen });

          if (check.action === 'recover') {
            console.log(
              `[CLEANUP CRON] Booking ${booking.id} has SUCCEEDED Stripe PaymentIntent ` +
              `${check.paymentIntent.id}; replaying webhook instead of deleting (missed delivery rescue)`
            );
            try {
              await this.webhookController.handlePaymentSuccess(check.paymentIntent);
            } catch (replayError) {
              console.error(
                `[CLEANUP CRON] Webhook replay failed for booking ${booking.id}; deferring delete:`,
                replayError
              );
            }
            continue;
          }

          if (check.action === 'defer') {
            console.log(
              `[CLEANUP CRON] Booking ${booking.id} deferred` +
              (check.paymentIntent ? ` (PI ${check.paymentIntent.id} status=${check.paymentIntent.status})` : '') +
              `; will reconsider next sweep`
            );
            continue;
          }

          // action === 'delete': fall through to the existing delete path.
          console.log(
            `[CLEANUP CRON] Booking ${booking.id} cleared for deletion ` +
            (check.paymentIntent
              ? `(Stripe PI ${check.paymentIntent.id} status=${check.paymentIntent.status})`
              : '(no Stripe PaymentIntent matched)')
          );
        }

        await connection.beginTransaction();

        try {
          if (booking.booking_made_by === 'gift_voucher') {
            await connection.query(
              `DELETE FROM gift_voucher_copieds WHERE bid = ?`,
              [booking.id]
            );
            await connection.query(`DELETE FROM bookings WHERE id = ?`, [booking.id]);
            console.log(`[CLEANUP CRON] Deleted abandoned gift voucher booking ID: ${booking.id}`);
            await connection.commit();
            continue;
          }

          await archiveAndDeleteBooking(connection, booking, {
            reason: frozen
              ? 'Auto-cleanup: course frozen by admin before payment completed'
              : `Auto-cleanup: unpaid timeout after ${timeoutMinutes} minutes`,
            cancelledVia: 'node-cleanup-cron',
            at: cleanupAt,
            timeoutMinutes,
          });

          await connection.commit();
          console.log(`[CLEANUP CRON] Archived + deleted booking ID: ${booking.id}`);
        } catch (error) {
          await connection.rollback();
          console.error(`[CLEANUP CRON] Error deleting booking ${booking.id}:`, error);
        }
      }

      console.log('[CLEANUP CRON] Cleanup completed');
    } catch (error) {
      console.error('[CLEANUP CRON] Error during cleanup:', error);
    } finally {
      connection.release();
    }
  }

  start() {
    cron.schedule('*/15 * * * *', () => {
      console.log('[CLEANUP CRON] Running scheduled cleanup...');
      this.cleanupUnpaidBookings();
    });

    console.log('[CLEANUP CRON] Scheduled to run every 15 minutes');
  }
}

module.exports = BookingCleanupCron;
