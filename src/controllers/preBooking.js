// src/controllers/preBooking.js
class PreBookingController {
  constructor(pool) {
    this.pool = pool;
  }

  // Check if IP is blocked
  async checkIpBlock(req, res) {
    try {
      let { ip_address } = req.body;

      // Use server's detected IP if not provided or is localhost
      if (!ip_address || ip_address === '127.0.0.1' || ip_address === 'localhost') {
        ip_address = req.clientIp || req.ip;
      }

      if (!ip_address) {
        return res.status(400).json({ blocked: false, message: 'IP address required' });
      }

      const [blocked] = await this.pool.query(`
        SELECT COUNT(*) as count FROM blocked_ips
        WHERE ip_address = ? AND blocked_until > NOW()
      `, [ip_address]);

      if (blocked[0].count > 0) {
        return res.json({
          blocked: true,
          message: 'IP is currently blocked'
        });
      }

      res.json({ blocked: false });
    } catch (error) {
      console.error('Error checking IP block:', error);
      res.status(500).json({ blocked: false, message: 'Server error' });
    }
  }

  // Get course availability
  async getCourseAvailability(req, res) {
    try {
      const { eventId } = req.params;

      const [event] = await this.pool.query(`
        SELECT booking_limit FROM course_events WHERE id = ?
      `, [eventId]);

      if (!event.length) {
        return res.status(404).json({ error: 'Event not found' });
      }

      const [bookings] = await this.pool.query(`
        SELECT COALESCE(SUM(spaces), 0) as bookings_done
        FROM bookings
        WHERE course_event_id = ? AND status IN (1, 2)
      `, [eventId]);

      const [locks] = await this.pool.query(`
        SELECT COALESCE(SUM(space_required), 0) as current_locks
        FROM lock_bookings
        WHERE parent = ? AND created > DATE_SUB(NOW(), INTERVAL 15 MINUTE) AND delete_process = 0
      `, [eventId]);

      const bookingLimit = event[0].booking_limit;
      const bookingsDone = bookings[0].bookings_done;
      const currentLocks = locks[0].current_locks;
      const availableSpaces = Math.max(0, bookingLimit - bookingsDone - currentLocks);

      res.json({
        available_spaces: availableSpaces,
        booking_limit: bookingLimit,
        bookings_done: bookingsDone,
        current_locks: currentLocks
      });
    } catch (error) {
      console.error('Error getting course availability:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }

  // Lock booking spaces
  async lockSpaces(req, res) {
    try {
      let { event_id, space_count, ip_address, user_id = 0 } = req.body;

      // Use server's detected IP if not provided or is localhost
      if (!ip_address || ip_address === '127.0.0.1' || ip_address === 'localhost') {
        ip_address = req.clientIp || req.ip;
      }

      if (!event_id || !space_count || !ip_address) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
      }

      // Check availability first
      const availability = await this.checkAvailability(event_id, space_count);
      if (!availability.available) {
        return res.status(400).json({ success: false, message: availability.message });
      }

      // Get parent event ID from course_events table
      const [event] = await this.pool.query(`
        SELECT parent FROM course_events WHERE id = ?
      `, [event_id]);

      if (!event.length) {
        return res.status(404).json({ success: false, message: 'Event not found' });
      }

      const parentId = event[0].parent;

      const [result] = await this.pool.query(`
        INSERT INTO lock_bookings (event_id, parent, user_id, space_required, ip_address, manual_lock, automatic_lock, payment_page_stauts, delete_process, created, modified)
        VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, NOW(), NOW())
      `, [event_id, parentId, user_id, space_count, ip_address]);

      // Update course_events current_locks
      await this.pool.query(`
        UPDATE course_events
        SET current_locks = current_locks + ?, modified = NOW()
        WHERE id = ?
      `, [space_count, event_id]);

      res.json({
        lock_id: result.insertId.toString(),
        success: true
      });
    } catch (error) {
      console.error('Error locking spaces:', error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  // Create pre-booking with attendees
  async createPreBooking(req, res) {
    console.log('=== CREATE PRE-BOOKING CALLED ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    
    try {
      let { event_id, attendees, user_id = 0, ip_address, photocard_confirmed, terms_agreed } = req.body;

      // Use server's detected IP if not provided or is localhost
      if (!ip_address || ip_address === '127.0.0.1' || ip_address === 'localhost') {
        ip_address = req.clientIp || req.ip;
      }

      if (!event_id || !attendees || !Array.isArray(attendees) || attendees.length === 0) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
      }

      if (!photocard_confirmed) {
        return res.status(400).json({ success: false, message: 'Please confirm that the person attending can present their photocard driving licence on the day of the course' });
      }

      if (!terms_agreed) {
        return res.status(400).json({ success: false, message: 'Please agree to the Terms & Conditions and Privacy Policy' });
      }

      const space_count = attendees.length;

      // Check availability
      const availability = await this.checkAvailability(event_id, space_count);
      if (!availability.available) {
        return res.status(400).json({ success: false, message: availability.message });
      }

      const connection = await this.pool.getConnection();
      await connection.beginTransaction();

      try {
        // Create booking record
        const bookingRef = `PRE_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.log('Creating booking with ref:', bookingRef);
        
        const [bookingResult] = await connection.query(`
          INSERT INTO bookings (course_id, course_event_id, user_id, type_of_book, spaces, payment_due, total_fees, vatrate, vat, total_amount, admin_payment_received, status, lockid, created, modified)
          VALUES ((SELECT course_id FROM course_events WHERE id = ?), ?, ?, 'o', ?, 0, 0, 0, 0, 0, 0, 0, 0, NOW(), NOW())
        `, [event_id, event_id, user_id, space_count]);

        const bookingId = bookingResult.insertId;
        console.log('Booking created with ID:', bookingId);

        // Create attendee records
        console.log('Creating attendee records for', attendees.length, 'attendees');
        for (let i = 0; i < attendees.length; i++) {
          const attendee = attendees[i];
          console.log(`Creating attendee ${i + 1}:`, attendee.first_name, attendee.sur_name);

          // Insert into booking_attendees
          const [attendeeResult] = await connection.query(`
            INSERT INTO booking_attendees (booking_id, booking_ref, first_name, sur_name, contact1, contact2, contact3, email, vehicle_type, license_type, license_number, theory_number, admin_notes, notes, \`primary\`, created)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, NOW())
          `, [bookingId, bookingRef, attendee.first_name || '', attendee.sur_name || '', attendee.contact1 || '', attendee.contact2 || '', attendee.contact3 || '', attendee.email || '', attendee.vehicle_type || 0, attendee.license_type || 0, attendee.license_number || '', attendee.theory_number || '', i === 0 ? 1 : 0]);
          
          console.log('Attendee record created with ID:', attendeeResult.insertId);

          // Insert into booking_attendees_dropdown
          const [dropdownResult] = await connection.query(`
            INSERT INTO booking_attendees_dropdown (booking_id, booking_ref, first_name, sur_name, contact1, contact2, contact3, email, vehicle_type, license_type, license_number, theory_number, notes, \`primary\`, created, updated)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, NOW(), NOW())
          `, [bookingId, bookingRef, attendee.first_name || '', attendee.sur_name || '', attendee.contact1 || '', attendee.contact2 || '', attendee.contact3 || '', attendee.email || '', attendee.vehicle_type || 0, attendee.license_type || 0, attendee.license_number || '', attendee.theory_number || '', i === 0 ? 1 : 0]);
          
          console.log('Dropdown record created with ID:', dropdownResult.insertId);
        }

        // Create lock record
        const [event] = await connection.query(`SELECT parent FROM course_events WHERE id = ?`, [event_id]);
        const parentId = event[0].parent;
        console.log('Creating lock for event:', event_id, 'parent:', parentId);

        const [lockResult] = await connection.query(`
          INSERT INTO lock_bookings (event_id, parent, user_id, space_required, ip_address, manual_lock, automatic_lock, payment_page_stauts, delete_process, created, modified)
          VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, NOW(), NOW())
        `, [event_id, parentId, user_id, space_count, ip_address]);
        
        console.log('Lock created with ID:', lockResult.insertId);

        // Update course_events
        console.log('Updating course_events - adding locks:', space_count, 'bookings:', space_count);
        await connection.query(`
          UPDATE course_events
          SET current_locks = current_locks + ?, bookings_done = bookings_done + ?, modified = NOW()
          WHERE id = ?
        `, [space_count, space_count, event_id]);

        await connection.commit();
        connection.release();

        res.json({
          success: true,
          booking_id: bookingId,
          booking_ref: bookingRef,
          message: 'Pre-booking created successfully'
        });

      } catch (error) {
        await connection.rollback();
        connection.release();
        throw error;
      }

    } catch (error) {
      console.error('Error creating pre-booking:', error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  // Check availability helper
  async checkAvailability(event_id, space_count) {
    const [event] = await this.pool.query(`
      SELECT booking_limit, bookings_done, current_locks FROM course_events WHERE id = ?
    `, [event_id]);

    if (!event.length) {
      return { available: false, message: 'Event not found' };
    }

    const { booking_limit, bookings_done, current_locks } = event[0];
    const availableSpaces = booking_limit - bookings_done - current_locks;

    if (availableSpaces < space_count) {
      return { available: false, message: 'Insufficient spaces available' };
    }

    return { available: true, available_spaces: availableSpaces };
  }

  // Cleanup expired pre-bookings (10+ minutes old)
  async cleanupExpiredPreBookings(req, res) {
    try {
      let { user_id, ip_address } = req.body;

      // Normalize IP address (convert IPv6 localhost to IPv4)
      if (ip_address === '::1' || ip_address === '::ffff:127.0.0.1') {
        ip_address = '127.0.0.1';
      }
      
      // Use server's detected IP if not provided
      if (!ip_address || ip_address === 'localhost') {
        let detectedIp = req.clientIp || req.ip || req.connection.remoteAddress;
        if (detectedIp === '::1' || detectedIp === '::ffff:127.0.0.1') {
          detectedIp = '127.0.0.1';
        }
        ip_address = detectedIp;
      }

      const connection = await this.pool.getConnection();
      await connection.beginTransaction();

      try {
        let cleanedBookings = 0;
        let cleanedLocks = 0;
        const affectedEventIds = new Set();

        // Find expired locks (10+ minutes old) - debug query first
        console.log('Checking for expired locks...');
        
        // First check all locks
        const [allLocks] = await connection.query(`
          SELECT id, event_id, user_id, ip_address, space_required, created, 
                 TIMESTAMPDIFF(MINUTE, created, NOW()) as minutes_old
          FROM lock_bookings 
          WHERE delete_process = 0
          ORDER BY created DESC
          LIMIT 10
        `);
        
        console.log('All recent locks:', allLocks);
        
        // Now find expired ones (10+ minutes)
        const [expiredLocks] = await connection.query(`
          SELECT id, event_id, user_id, ip_address, space_required, created,
                 TIMESTAMPDIFF(MINUTE, created, NOW()) as minutes_old
          FROM lock_bookings 
          WHERE TIMESTAMPDIFF(MINUTE, created, NOW()) >= 10
          AND delete_process = 0
          ${user_id ? 'AND user_id = ?' : ''}
          ${ip_address && !user_id ? 'AND ip_address = ?' : ''}
        `, user_id ? [user_id] : (ip_address ? [ip_address] : []));

        console.log(`Found ${expiredLocks.length} expired locks`);

        // Process each expired lock
        for (const lock of expiredLocks) {
          affectedEventIds.add(lock.event_id);

          // Find unpaid bookings for this event
          const [unpaidBookings] = await connection.query(`
            SELECT b.id, b.course_event_id, b.spaces
            FROM bookings b
            WHERE b.course_event_id = ? 
            AND (b.status = 0 OR b.admin_payment_received = 0)
          `, [lock.event_id]);

          // Delete unpaid bookings and related data
          for (const booking of unpaidBookings) {
            await connection.query(`DELETE FROM booking_attendees WHERE booking_id = ?`, [booking.id]);
            await connection.query(`DELETE FROM booking_attendees_dropdown WHERE booking_id = ?`, [booking.id]);
            await connection.query(`DELETE FROM bookings WHERE id = ?`, [booking.id]);

            // Reset bookings_done count
            await connection.query(`
              UPDATE course_events
              SET bookings_done = GREATEST(0, bookings_done - ?), modified = NOW()
              WHERE id = ?
            `, [booking.spaces, booking.course_event_id]);

            cleanedBookings++;
          }

          // Mark lock for deletion
          await connection.query(`
            UPDATE lock_bookings 
            SET delete_process = 1, modified = NOW() 
            WHERE id = ?
          `, [lock.id]);

          cleanedLocks++;
        }

        // Delete marked locks
        await connection.query(`DELETE FROM lock_bookings WHERE delete_process = 1`);

        // Recalculate current_locks for affected events
        for (const eventId of affectedEventIds) {
          await connection.query(`
            UPDATE course_events
            SET current_locks = (
              SELECT COALESCE(SUM(space_required), 0)
              FROM lock_bookings lb
              WHERE lb.event_id = ? AND lb.delete_process = 0
            ),
            modified = NOW()
            WHERE id = ?
          `, [eventId, eventId]);
        }

        await connection.commit();
        connection.release();

        console.log(`[CLEANUP-PREBOOKING] Cleaned ${cleanedBookings} bookings and ${cleanedLocks} locks`);

        res.json({
          success: true,
          message: 'Expired pre-bookings cleaned up successfully',
          cleaned_bookings: cleanedBookings,
          cleaned_locks: cleanedLocks,
          ip_used: ip_address
        });

      } catch (error) {
        await connection.rollback();
        connection.release();
        throw error;
      }

    } catch (error) {
      console.error('Error cleaning up expired pre-bookings:', error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  // Log IP activity
  async logIpActivity(req, res) {
    try {
      let { ip_address, lock_session_id, booking_status = 'pending' } = req.body;

      // Only use server IP if frontend didn't send any IP
      if (!ip_address) {
        let detectedIp = req.clientIp || req.ip || req.connection.remoteAddress;
        if (detectedIp === '::1' || detectedIp === '::ffff:127.0.0.1') {
          detectedIp = '127.0.0.1';
        }
        ip_address = detectedIp;
      }

      if (!ip_address || !lock_session_id) {
        return res.status(400).json({ logged: false, message: 'Missing required fields' });
      }

      // Check if already exists
      const [existing] = await this.pool.query(`
        SELECT COUNT(*) as count FROM ip_logs WHERE lock_session_id = ?
      `, [lock_session_id]);

      if (existing[0].count === 0) {
        await this.pool.query(`
          INSERT INTO ip_logs (ip_address, booking_status, lock_session_id, created_at)
          VALUES (?, ?, ?, NOW())
        `, [ip_address, booking_status, lock_session_id]);
      }

      res.json({ logged: true, ip_used: ip_address });
    } catch (error) {
      console.error('Error logging IP activity:', error);
      res.status(500).json({ logged: false, message: 'Server error' });
    }
  }

  // Update session (using auth token)
  async updateSession(req, res) {
    try {
      const { session_id, data } = req.body;
      const userId = req.user?.id || null;

      if (!session_id || !data) {
        return res.status(400).json({ updated: false, message: 'Missing required fields' });
      }

      // Store session data in booking_sessions table
      await this.pool.query(`
        INSERT INTO booking_sessions (session_id, user_id, event_id, event_type, franchise_id,
                                    space_required, remote_address, lock_session, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
        event_id = VALUES(event_id),
        event_type = VALUES(event_type),
        franchise_id = VALUES(franchise_id),
        space_required = VALUES(space_required),
        remote_address = VALUES(remote_address),
        lock_session = VALUES(lock_session),
        updated_at = NOW()
      `, [
        session_id, userId, data.eventId, data.eventType, data.franchiseId,
        data.space_required, data.remote_address, JSON.stringify(data.lock_session)
      ]);

      res.json({ updated: true });
    } catch (error) {
      console.error('Error updating session:', error);
      res.status(500).json({ updated: false, message: 'Server error' });
    }
  }

  // External API integration (Ride2Api)
  async holdExternalSpace(req, res) {
    try {
      const { event_id, space_count, location_id } = req.body;

      // Check if R2API setting is enabled
      const [settings] = await this.pool.query(`
        SELECT is_r2api_setting FROM settings LIMIT 1
      `);

      if (!settings.length || !settings[0].is_r2api_setting) {
        return res.json({ held: false, message: 'External API not enabled' });
      }

      // Only for specific locations
      const externalLocations = [1, 4, 15, 18];
      if (!externalLocations.includes(parseInt(location_id))) {
        return res.json({ held: false, message: 'Location does not require external hold' });
      }

      // Mock external API call (replace with actual implementation)
      const externalRef = `EXT_${event_id}_${Date.now()}`;

      res.json({
        held: true,
        external_ref: externalRef
      });
    } catch (error) {
      console.error('Error holding external space:', error);
      res.status(500).json({ held: false, message: 'Server error' });
    }
  }

  // Cleanup expired locks
  async cleanupExpiredLocks(req, res) {
    const connection = await this.pool.getConnection();
    await connection.beginTransaction();

    try {
      // Step 1: Find all expired locks (created more than 10 minutes ago and not yet processed)
      const [expiredLocks] = await connection.query(`
        SELECT id, event_id, space_required
        FROM lock_bookings
        WHERE created < DATE_SUB(NOW(), INTERVAL 10 MINUTE) 
          AND delete_process = 0
      `);

      let cleanedBookings = 0;
      let cleanedLocks = 0;

      // Step 2: For each expired lock, find and delete associated unpaid bookings
      if (expiredLocks.length > 0) {
        for (const lock of expiredLocks) {
          // Find all unpaid bookings for this event
          const [unpaidBookings] = await connection.query(`
            SELECT id, spaces, course_event_id
            FROM bookings
            WHERE course_event_id = ? 
              AND (status = 0 OR admin_payment_received = 0)
              AND created >= DATE_SUB(?, INTERVAL 20 MINUTE)
              AND created <= DATE_ADD(?, INTERVAL 5 MINUTE)
            LIMIT 1
          `, [lock.event_id, lock.created, lock.created]);

          // Delete bookings and attendees
          for (const booking of unpaidBookings) {
            // Delete attendee records
            await connection.query(`DELETE FROM booking_attendees WHERE booking_id = ?`, [booking.id]);
            await connection.query(`DELETE FROM booking_attendees_dropdown WHERE booking_id = ?`, [booking.id]);
            
            // Delete booking record
            await connection.query(`DELETE FROM bookings WHERE id = ?`, [booking.id]);

            // Restore course_events counts
            await connection.query(`
              UPDATE course_events
              SET bookings_done = GREATEST(0, bookings_done - ?), modified = NOW()
              WHERE id = ?
            `, [booking.spaces, booking.course_event_id]);

            cleanedBookings++;
          }
        }

        // Step 3: Mark all expired locks as processed
        const [markResult] = await connection.query(`
          UPDATE lock_bookings
          SET delete_process = 1, modified = NOW()
          WHERE created < DATE_SUB(NOW(), INTERVAL 10 MINUTE) AND delete_process = 0
        `);

        cleanedLocks = markResult.affectedRows;
      }

      // Step 4: Recalculate current_locks for all affected events
      await connection.query(`
        UPDATE course_events ce
        SET current_locks = (
          SELECT COALESCE(SUM(space_required), 0)
          FROM lock_bookings lb
          WHERE lb.event_id = ce.id
          AND lb.delete_process = 0
        ),
        modified = NOW()
      `);

      await connection.commit();
      connection.release();

      console.log(`[CLEANUP] Cleaned ${cleanedBookings} bookings and ${cleanedLocks} locks`);

      res.json({ 
        success: true, 
        message: 'Expired locks cleaned up successfully',
        cleaned_bookings: cleanedBookings,
        cleaned_locks: cleanedLocks
      });
    } catch (error) {
      await connection.rollback();
      connection.release();
      console.error('Error cleaning up locks:', error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  // Handle payment confirmation/cancellation
  async handlePaymentResult(req, res) {
    const connection = await this.pool.getConnection();
    await connection.beginTransaction();

    try {
      const { booking_id, payment_status, transaction_id } = req.body;

      if (!booking_id || !payment_status) {
        return res.status(400).json({ 
          success: false, 
          message: 'booking_id and payment_status required' 
        });
      }

      // Get booking details
      const [bookings] = await connection.query(`
        SELECT b.id, b.course_event_id, b.spaces, b.status
        FROM bookings b
        WHERE b.id = ?
      `, [booking_id]);

      if (!bookings.length) {
        return res.status(404).json({ 
          success: false, 
          message: 'Booking not found' 
        });
      }

      const booking = bookings[0];

      if (payment_status === 'success' || payment_status === 'completed') {
        // Payment successful - confirm booking
        await connection.query(`
          UPDATE bookings
          SET status = 1, admin_payment_received = 1, modified = NOW()
          WHERE id = ?
        `, [booking_id]);

        // Mark associated locks as processed
        await connection.query(`
          UPDATE lock_bookings
          SET delete_process = 1, modified = NOW()
          WHERE event_id = ? AND created >= DATE_SUB(NOW(), INTERVAL 30 MINUTE)
        `, [booking.course_event_id]);

        await connection.commit();
        connection.release();

        return res.json({ 
          success: true, 
          message: 'Payment confirmed and booking activated',
          booking_id: booking_id
        });

      } else if (payment_status === 'failed' || payment_status === 'cancelled') {
        // Payment failed - cleanup booking and locks

        // Delete attendee records
        await connection.query(`DELETE FROM booking_attendees WHERE booking_id = ?`, [booking_id]);
        await connection.query(`DELETE FROM booking_attendees_dropdown WHERE booking_id = ?`, [booking_id]);
        
        // Delete booking record
        await connection.query(`DELETE FROM bookings WHERE id = ?`, [booking_id]);

        // Restore course_events counts
        await connection.query(`
          UPDATE course_events
          SET bookings_done = GREATEST(0, bookings_done - ?), modified = NOW()
          WHERE id = ?
        `, [booking.spaces, booking.course_event_id]);

        // Delete related locks
        await connection.query(`
          DELETE FROM lock_bookings
          WHERE event_id = ? AND created >= DATE_SUB(NOW(), INTERVAL 30 MINUTE)
        `, [booking.course_event_id]);

        // Recalculate current_locks
        await connection.query(`
          UPDATE course_events
          SET current_locks = (
            SELECT COALESCE(SUM(space_required), 0)
            FROM lock_bookings lb
            WHERE lb.event_id = ce.id AND lb.delete_process = 0
          ),
          modified = NOW()
        `, [booking.course_event_id]);

        await connection.commit();
        connection.release();

        return res.json({ 
          success: true, 
          message: 'Payment failed - booking and locks cleaned up',
          booking_id: booking_id
        });

      } else {
        await connection.rollback();
        connection.release();
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid payment_status. Use: success, failed, or cancelled' 
        });
      }

    } catch (error) {
      await connection.rollback();
      connection.release();
      console.error('Error handling payment result:', error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }
}

module.exports = PreBookingController;