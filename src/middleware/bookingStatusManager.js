// src/middleware/bookingStatusManager.js
//
// Booking status semantics MUST match the legacy PHP system, because both
// stacks read/write the same `bookings` table.
//
// Legacy PHP truth (verified in 1stop-php):
//   0 = PENDING       -> row inserted before payment
//   1 = CONFIRMED     -> payment received (Stripe / WorldPay / MOTO)
//   2 = REFUNDED      -> set together with `refundable = 2` from
//                        admin/booking_refund_delete_common.php
//   5 = MOVED_OUT     -> tombstone left behind by the "move course" admin flow
//                        (Booking::changeBookingstatus -> saveMoveBooking).
//                        Filtered out everywhere via `(status != 5 OR status IS NULL)`.
//
// The legacy admin "Delete" flow does NOT use a status value at all; it hard
// deletes the row from `bookings`, archives a serialized snapshot into
// `deleted_bookings`, writes an audit row to `booking_update_history`, and
// soft-deletes related rows in `booking_payments` (isDelete = 1).
//
// Lock model used by the new flow (per client request): we only mutate
// `course_events.current_locks`. We do NOT use the legacy `lock_bookings`
// table to express held seats during checkout.
//
// Historical note: an earlier version of this file invented
// COMPLETED:2 / CANCELLED:3 / NO_SHOW:4 and ran cron + middleware that
// auto-wrote those values. This collided with PHP's REFUNDED:2 and produced
// rows the legacy admin would not display ("client cannot see a booking").
// All such auto-mutations have been removed; "completed" is now derived from
// event dates at read time, and cancellations follow the PHP archive flow.

class BookingStatusManager {
  /**
   * Booking status definitions (must mirror PHP `bookings.status`).
   */
  static STATUS = {
    PENDING_PAYMENT: 0,
    CONFIRMED: 1,
    REFUNDED: 2,
    MOVED_OUT: 5,
  };

  /**
   * Status text mappings.
   */
  static STATUS_TEXT = {
    0: 'Pending Payment',
    1: 'Confirmed',
    2: 'Refunded',
    5: 'Moved',
  };

  /**
   * Get status text from status code.
   */
  static getStatusText(status) {
    return this.STATUS_TEXT[status] || 'Unknown';
  }

  /**
   * Whether the booking is still "live" from the legacy schema's point of
   * view (i.e. not a moved-out tombstone). Matches the PHP filter
   *   `(bookings.status != 5 OR bookings.status IS NULL)`.
   */
  static isLive(status) {
    return status !== this.STATUS.MOVED_OUT;
  }

  /**
   * Whether the booking holds (or held) a seat that should count against
   * course capacity. Refunded rows are kept in the table but no longer hold
   * a seat in the legacy admin's reporting.
   */
  static isActive(status) {
    return status === this.STATUS.PENDING_PAYMENT
        || status === this.STATUS.CONFIRMED;
  }

  /**
   * Derived "completed" check: PHP never stored a Completed flag; it's
   * inferred from the latest course event date being in the past while the
   * booking is still confirmed.
   */
  static isCompleted(status, lastEventDate) {
    if (status !== this.STATUS.CONFIRMED) return false;
    if (!lastEventDate) return false;
    const last = new Date(lastEventDate);
    if (Number.isNaN(last.getTime())) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return last < today;
  }

  /**
   * Editable bookings: only pending or confirmed rows can have their
   * details modified.
   */
  static canModify(status) {
    return this.isActive(status);
  }

  /**
   * Cancellable bookings: only active rows; refund / move are admin-only
   * paths and don't go through the user-side cancel.
   */
  static canCancel(status) {
    return this.isActive(status);
  }

  /**
   * Valid status transitions written directly to `bookings.status`.
   * Note: real cancellations are NOT a status transition in this schema;
   * they remove the row and archive it into `deleted_bookings`.
   */
  static getValidTransitions(currentStatus) {
    const transitions = {
      [this.STATUS.PENDING_PAYMENT]: [this.STATUS.CONFIRMED],
      [this.STATUS.CONFIRMED]: [this.STATUS.REFUNDED, this.STATUS.MOVED_OUT],
      [this.STATUS.REFUNDED]: [],
      [this.STATUS.MOVED_OUT]: [],
    };
    return transitions[currentStatus] || [];
  }

  /**
   * Validate if a status transition is allowed.
   */
  static isValidTransition(fromStatus, toStatus) {
    return this.getValidTransitions(fromStatus).includes(toStatus);
  }

  /**
   * No-op middleware kept for backward compatibility with index.js wiring.
   * The previous implementation auto-rewrote bookings.status on every
   * /bookings or /payment request, which caused the very bug we're fixing.
   * Lock expiry is now owned by cleanupExpiredLocks cron, and unpaid
   * booking expiry by cleanupUnpaidBookings cron.
   */
  static createStatusUpdateMiddleware(_pool) {
    return (req, res, next) => next();
  }

  /**
   * No-op cleanup hook kept for backward compatibility with index.js
   * wiring. See note on createStatusUpdateMiddleware. The two dedicated
   * crons handle the side effects this method used to perform.
   */
  static startCleanupJob(_pool) {
    console.log(
      '[BookingStatusManager] startCleanupJob is now a no-op; expiry is handled by cleanupUnpaidBookings + cleanupExpiredLocks crons.'
    );
  }

  /**
   * Calculate space allocation changes for a status transition that this
   * service is allowed to perform (i.e. 0 -> 1 on payment, or the rare
   * confirmed -> refunded).
   *
   * Real cancellations are not status transitions in this schema, so they
   * do not go through this helper; the cancel flow updates counters
   * directly while removing the row.
   */
  static calculateSpaceChanges(oldStatus, newStatus, spaces) {
    let lockChange = 0;
    let bookingChange = 0;

    // 0 -> 1: payment received, lock becomes a real booking
    if (oldStatus === this.STATUS.PENDING_PAYMENT && newStatus === this.STATUS.CONFIRMED) {
      lockChange = -spaces;
      bookingChange = spaces;
    }
    // 1 -> 0: rare admin reversal back to pending
    else if (oldStatus === this.STATUS.CONFIRMED && newStatus === this.STATUS.PENDING_PAYMENT) {
      lockChange = spaces;
      bookingChange = -spaces;
    }
    // 1 -> 2: refunded, seat is released from bookings_done (PHP also
    // releases capacity counters in booking_refund_delete_common.php).
    else if (oldStatus === this.STATUS.CONFIRMED && newStatus === this.STATUS.REFUNDED) {
      bookingChange = -spaces;
    }
    // 1 -> 5: moved-out tombstone; saveMoveBooking already runs the
    // lessEditedBooking / addEditBookingsdone counter dance, so we leave
    // counters alone here to avoid double counting.
    else if (oldStatus === this.STATUS.CONFIRMED && newStatus === this.STATUS.MOVED_OUT) {
      // intentionally no counter change
    }

    return { lockChange, bookingChange };
  }

  /**
   * Apply space allocation changes to course events.
   */
  static async updateEventSpaces(pool, courseEventId, lockChange, bookingChange) {
    if (lockChange === 0 && bookingChange === 0) return;
    const { applyGroupSpaceDelta } = require('../utils/courseEventGroup');
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await applyGroupSpaceDelta(connection, courseEventId, {
        lockDelta: lockChange,
        bookingsDoneDelta: bookingChange,
      });
      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Booking summary for an event. Counts are bucketed by the real PHP
   * statuses; "completed" is derived from event dates rather than stored.
   */
  static async getEventBookingSummary(pool, courseEventId) {
    const [summary] = await pool.query(
      `SELECT
         ce.booking_limit,
         ce.bookings_done,
         ce.current_locks,
         (ce.booking_limit - ce.bookings_done - ce.current_locks) AS spaces_available,
         COUNT(CASE WHEN b.status IS NOT NULL AND b.status <> 5 THEN b.id END) AS total_bookings,
         COUNT(CASE WHEN b.status = 0 THEN 1 END) AS pending_bookings,
         COUNT(CASE WHEN b.status = 1 THEN 1 END) AS confirmed_bookings,
         COUNT(CASE WHEN b.status = 2 THEN 1 END) AS refunded_bookings,
         COUNT(CASE WHEN b.status = 5 THEN 1 END) AS moved_bookings,
         SUM(CASE WHEN b.status IN (0, 1) THEN b.spaces ELSE 0 END) AS active_spaces
       FROM course_events ce
       LEFT JOIN bookings b ON ce.id = b.course_event_id
       WHERE ce.id = ?
       GROUP BY ce.id`,
      [courseEventId]
    );

    return summary[0] || null;
  }

  /**
   * Validate booking capacity before creating/updating.
   * Only pending (0) and confirmed (1) rows hold a seat for capacity
   * purposes; refunded (2) and moved-out (5) do not.
   */
  static async validateEventCapacity(pool, courseEventId, requiredSpaces, excludeBookingId = null) {
    const [result] = await pool.query(
      `SELECT
         ce.booking_limit,
         ce.bookings_done,
         ce.current_locks,
         (ce.booking_limit - ce.bookings_done - ce.current_locks) AS spaces_available,
         COALESCE(SUM(CASE WHEN b.status IN (0, 1) AND b.id != ? THEN b.spaces ELSE 0 END), 0) AS used_spaces
       FROM course_events ce
       LEFT JOIN bookings b ON ce.id = b.course_event_id
       WHERE ce.id = ?
       GROUP BY ce.id`,
      [excludeBookingId || 0, courseEventId]
    );

    if (!result.length) {
      throw new Error('Course event not found');
    }

    const event = result[0];
    if (event.spaces_available < requiredSpaces) {
      throw new Error(`Insufficient spaces available. Only ${event.spaces_available} spaces remaining`);
    }
    return event;
  }
}

module.exports = BookingStatusManager;
