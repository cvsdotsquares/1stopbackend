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
        // This middleware can be used to automatically update booking statuses
        // For example, mark bookings as NO_SHOW if event date has passed and they're still confirmed
        
        // Only run this for certain routes to avoid performance impact
        const shouldRunStatusUpdate = req.path.includes('/bookings') && req.method === 'GET';
        
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
   * Update expired bookings to appropriate statuses
   */
  static async updateExpiredBookings(pool) {
    const connection = await pool.getConnection();
    
    try {
      await connection.beginTransaction();

      // Mark confirmed bookings as completed if event was yesterday or earlier
      const [completedBookings] = await connection.query(`
        UPDATE bookings b
        JOIN course_events ce ON b.course_event_id = ce.id
        SET b.status = ?, b.modified = NOW()
        WHERE b.status = ? 
          AND ce.event_date <= DATE_SUB(CURDATE(), INTERVAL 1 DAY)
          AND ce.event_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      `, [this.STATUS.COMPLETED, this.STATUS.CONFIRMED]);

      // Mark pending payment bookings as cancelled if event is tomorrow or sooner
      const [cancelledBookings] = await connection.query(`
        UPDATE bookings b
        JOIN course_events ce ON b.course_event_id = ce.id
        SET b.status = ?, 
            b.cancellation_reason = 'Auto-cancelled: Payment not received', 
            b.cancelled_at = NOW(),
            b.modified = NOW()
        WHERE b.status = ? 
          AND ce.event_date <= DATE_ADD(CURDATE(), INTERVAL 1 DAY)
      `, [this.STATUS.CANCELLED, this.STATUS.PENDING_PAYMENT]);

      // Release spaces from cancelled bookings
      if (cancelledBookings.affectedRows > 0) {
        await connection.query(`
          UPDATE course_events ce
          JOIN bookings b ON ce.id = b.course_event_id
          SET ce.current_locks = GREATEST(0, ce.current_locks - b.spaces)
          WHERE b.status = ? 
            AND b.modified >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
        `, [this.STATUS.CANCELLED]);
      }

      await connection.commit();

      if (completedBookings.affectedRows > 0 || cancelledBookings.affectedRows > 0) {
        console.log(`Status update: ${completedBookings.affectedRows} completed, ${cancelledBookings.affectedRows} cancelled`);
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