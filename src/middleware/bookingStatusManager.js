// src/middleware/bookingStatusManager.js

class BookingStatusManager {

  /**
   * Booking status definitions
   */
  static STATUS = {
    PENDING_PAYMENT: 0,
    CONFIRMED: 1,
    COMPLETED: 2,
    CANCELLED: 3,
    NO_SHOW: 4
  };

  /**
   * Status text mappings
   */
  static STATUS_TEXT = {
    0: 'Pending Payment',
    1: 'Confirmed',
    2: 'Completed',
    3: 'Cancelled',
    4: 'No Show'
  };

  /**
   * Get status text from status code
   */
  static getStatusText(status) {
    return this.STATUS_TEXT[status] || 'Unknown';
  }

  /**
   * Check if status allows modifications
   */
  static canModify(status) {
    return status === this.STATUS.PENDING_PAYMENT || status === this.STATUS.CONFIRMED;
  }

  /**
   * Check if status allows cancellation
   */
  static canCancel(status) {
    return status === this.STATUS.PENDING_PAYMENT || status === this.STATUS.CONFIRMED;
  }

  /**
   * Get valid status transitions
   */
  static getValidTransitions(currentStatus) {
    const transitions = {
      [this.STATUS.PENDING_PAYMENT]: [
        this.STATUS.CONFIRMED,
        this.STATUS.CANCELLED
      ],
      [this.STATUS.CONFIRMED]: [
        this.STATUS.PENDING_PAYMENT,
        this.STATUS.COMPLETED,
        this.STATUS.CANCELLED,
        this.STATUS.NO_SHOW
      ],
      [this.STATUS.COMPLETED]: [], // Final state
      [this.STATUS.CANCELLED]: [
        this.STATUS.PENDING_PAYMENT,
        this.STATUS.CONFIRMED
      ], // Can be reactivated by admin
      [this.STATUS.NO_SHOW]: [
        this.STATUS.CONFIRMED,
        this.STATUS.COMPLETED
      ] // Admin can correct
    };

    return transitions[currentStatus] || [];
  }

  /**
   * Validate if status transition is allowed
   */
  static isValidTransition(fromStatus, toStatus) {
    const validTransitions = this.getValidTransitions(fromStatus);
    return validTransitions.includes(toStatus);
  }

  /**
   * Middleware to automatically update booking statuses based on events
   */
  static createStatusUpdateMiddleware(pool) {
    return async (req, res, next) => {
      try {
        // Run cleanup more frequently for timeout bookings
        const shouldRunStatusUpdate = req.path.includes('/bookings') || req.path.includes('/payment');

        if (shouldRunStatusUpdate) {
          await this.updateExpiredBookings(pool);
        }

        next();
      } catch (error) {
        console.error('Status update middleware error:', error);
        // Don't fail the request if status update fails
        next();
      }
    };
  }

  /**
   * Start automatic cleanup job that runs every minute
   */
  static startCleanupJob(pool) {
    setInterval(async () => {
      try {
        await this.updateExpiredBookings(pool);
      } catch (error) {
        console.error('Cleanup job error:', error);
      }
    }, 60000); // Run every minute

    console.log('Booking cleanup job started - runs every minute');
  }

  /**
   * Update expired bookings to appropriate statuses
   */
  static async updateExpiredBookings(pool) {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // Cancel pending payment bookings older than 10 minutes
      const [timeoutBookings] = await connection.query(`
        UPDATE bookings b
        SET b.status = ?, b.modified = NOW()
        WHERE b.status = ?
          AND b.created <= DATE_SUB(NOW(), INTERVAL 10 MINUTE)
      `, [this.STATUS.CANCELLED, this.STATUS.PENDING_PAYMENT]);

      // Release spaces from timeout cancelled bookings
      if (timeoutBookings.affectedRows > 0) {
        await connection.query(`
          UPDATE course_events ce
          JOIN bookings b ON ce.id = b.course_event_id
          SET ce.current_locks = GREATEST(0, ce.current_locks - b.spaces)
          WHERE b.status = ?
            AND b.modified >= DATE_SUB(NOW(), INTERVAL 1 MINUTE)
        `, [this.STATUS.CANCELLED]);
      }

      // Mark confirmed bookings as completed only when ALL real event dates have passed.
      // TBC placeholder dates (1111-11-11, 0000-00-00) are excluded; if an event has only
      // TBC dates the subquery returns NULL, which evaluates to false and prevents premature completion.
      const [completedBookings] = await connection.query(`
        UPDATE bookings b
        JOIN course_events ce ON b.course_event_id = ce.id
        SET b.status = ?, b.modified = NOW()
        WHERE b.status = ?
          AND (
            SELECT MAX(ced.event_date)
            FROM course_event_dates ced
            WHERE ced.course_event_id = ce.id
              AND ced.event_date > '1900-01-01'
              AND ced.event_date NOT IN ('1111-11-11', '0000-00-00')
          ) < CURDATE()
      `, [this.STATUS.COMPLETED, this.STATUS.CONFIRMED]);

      // Cancel pending payment bookings when the first real event date is tomorrow or sooner.
      // TBC placeholder dates (1111-11-11, 0000-00-00) are excluded; if an event has only
      // TBC dates the subquery returns NULL, which evaluates to false and prevents erroneous cancellation.
      const [cancelledBookings] = await connection.query(`
        UPDATE bookings b
        JOIN course_events ce ON b.course_event_id = ce.id
        SET b.status = ?,
            b.modified = NOW()
        WHERE b.status = ?
          AND (
            SELECT MIN(ced.event_date)
            FROM course_event_dates ced
            WHERE ced.course_event_id = ce.id
              AND ced.event_date > '1900-01-01'
              AND ced.event_date NOT IN ('1111-11-11', '0000-00-00')
          ) <= DATE_ADD(CURDATE(), INTERVAL 1 DAY)
      `, [this.STATUS.CANCELLED, this.STATUS.PENDING_PAYMENT]);

      await connection.commit();

      if (timeoutBookings.affectedRows > 0 || completedBookings.affectedRows > 0 || cancelledBookings.affectedRows > 0) {
        console.log(`Status update: ${timeoutBookings.affectedRows} timeout cancelled, ${completedBookings.affectedRows} completed, ${cancelledBookings.affectedRows} event cancelled`);
      }

    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Calculate space allocation changes for status transitions
   */
  static calculateSpaceChanges(oldStatus, newStatus, spaces) {
    let lockChange = 0;
    let bookingChange = 0;

    // From pending (0) to confirmed (1)
    if (oldStatus === this.STATUS.PENDING_PAYMENT && newStatus === this.STATUS.CONFIRMED) {
      lockChange = -spaces; // Release locks
      bookingChange = spaces; // Add to bookings_done
    }
    // From confirmed (1) to pending (0)
    else if (oldStatus === this.STATUS.CONFIRMED && newStatus === this.STATUS.PENDING_PAYMENT) {
      lockChange = spaces; // Add to locks
      bookingChange = -spaces; // Remove from bookings_done
    }
    // From pending (0) to cancelled/no-show (3,4)
    else if (oldStatus === this.STATUS.PENDING_PAYMENT &&
             (newStatus === this.STATUS.CANCELLED || newStatus === this.STATUS.NO_SHOW)) {
      lockChange = -spaces; // Release locks
    }
    // From confirmed (1) to cancelled/no-show/completed (2,3,4)
    else if (oldStatus === this.STATUS.CONFIRMED &&
             (newStatus === this.STATUS.COMPLETED ||
              newStatus === this.STATUS.CANCELLED ||
              newStatus === this.STATUS.NO_SHOW)) {
      bookingChange = -spaces; // Remove from bookings_done
    }
    // From cancelled/no-show back to pending
    else if ((oldStatus === this.STATUS.CANCELLED || oldStatus === this.STATUS.NO_SHOW) &&
             newStatus === this.STATUS.PENDING_PAYMENT) {
      lockChange = spaces; // Add to locks
    }
    // From cancelled/no-show/completed back to confirmed
    else if ((oldStatus === this.STATUS.CANCELLED ||
              oldStatus === this.STATUS.NO_SHOW ||
              oldStatus === this.STATUS.COMPLETED) &&
             newStatus === this.STATUS.CONFIRMED) {
      bookingChange = spaces; // Add to bookings_done
    }

    return { lockChange, bookingChange };
  }

  /**
   * Apply space allocation changes to course events
   */
  static async updateEventSpaces(pool, courseEventId, lockChange, bookingChange) {
    if (lockChange !== 0 || bookingChange !== 0) {
      await pool.query(`
        UPDATE course_events
        SET
          current_locks = GREATEST(0, current_locks + ?),
          bookings_done = GREATEST(0, bookings_done + ?),
          modified = NOW()
        WHERE id = ?
      `, [lockChange, bookingChange, courseEventId]);
    }
  }

  /**
   * Get booking status summary for an event
   */
  static async getEventBookingSummary(pool, courseEventId) {
    const [summary] = await pool.query(`
      SELECT
        ce.booking_limit,
        ce.bookings_done,
        ce.current_locks,
        (ce.booking_limit - ce.bookings_done - ce.current_locks) as spaces_available,
        COUNT(b.id) as total_bookings,
        COUNT(CASE WHEN b.status = 0 THEN 1 END) as pending_bookings,
        COUNT(CASE WHEN b.status = 1 THEN 1 END) as confirmed_bookings,
        COUNT(CASE WHEN b.status = 2 THEN 1 END) as completed_bookings,
        COUNT(CASE WHEN b.status = 3 THEN 1 END) as cancelled_bookings,
        COUNT(CASE WHEN b.status = 4 THEN 1 END) as noshow_bookings,
        SUM(CASE WHEN b.status IN (0,1) THEN b.spaces ELSE 0 END) as active_spaces
      FROM course_events ce
      LEFT JOIN bookings b ON ce.id = b.course_event_id
      WHERE ce.id = ?
      GROUP BY ce.id
    `, [courseEventId]);

    return summary[0] || null;
  }

  /**
   * Validate booking capacity before creating/updating
   */
  static async validateEventCapacity(pool, courseEventId, requiredSpaces, excludeBookingId = null) {
    let query = `
      SELECT
        ce.booking_limit,
        ce.bookings_done,
        ce.current_locks,
        (ce.booking_limit - ce.bookings_done - ce.current_locks) as spaces_available,
        COALESCE(SUM(CASE WHEN b.status IN (0,1) AND b.id != ? THEN b.spaces ELSE 0 END), 0) as used_spaces
      FROM course_events ce
      LEFT JOIN bookings b ON ce.id = b.course_event_id
      WHERE ce.id = ?
      GROUP BY ce.id
    `;

    const [result] = await pool.query(query, [excludeBookingId || 0, courseEventId]);

    if (!result.length) {
      throw new Error('Course event not found');
    }

    const event = result[0];
    const availableSpaces = event.spaces_available;

    if (availableSpaces < requiredSpaces) {
      throw new Error(`Insufficient spaces available. Only ${availableSpaces} spaces remaining`);
    }

    return event;
  }
}

module.exports = BookingStatusManager;