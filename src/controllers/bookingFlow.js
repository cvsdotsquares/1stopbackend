// src/controllers/bookingFlow.js
class BookingFlowController {
  constructor(pool) {
    this.pool = pool;
  }

  async getCourses(req, res) {
    try {
      const [courses] = await this.pool.query(`
        SELECT DISTINCT
          c.id,
          c.course_name,
          c.course_abb,
          '1 day' as duration,
          c.is_cbt,
          c.status,
          0 as isVoucher
        FROM courses c
        JOIN course_events ce ON c.id = ce.course_id
        JOIN course_event_dates ced ON ce.id = ced.course_event_id
        WHERE c.status = '1'
          AND c.isDeleted = '0'
          AND ce.status = '1'
          AND ce.booking_limit > 0
          AND ced.event_date IS NOT NULL
          AND STR_TO_DATE(ced.event_date, '%Y-%m-%d') IS NOT NULL
          AND ced.event_date > CURDATE()
        ORDER BY c.course_name
      `);

      const formattedCourses = courses.map(course => ({
        id: course.id,
        course_name: course.course_name,
        course_abb: course.course_abb,
        duration: course.duration,
        school_one_off_price: parseFloat(course.school_one_off_price),
        is_cbt: course.is_cbt,
        status: course.status,
        isVoucher: Boolean(course.isVoucher)
      }));

      res.json({ success: true, data: formattedCourses });
    } catch (error) {
      console.error('Error fetching courses:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch courses' }
      });
    }
  }

  async getCourseAvailability(req, res) {
    try {
      const { course_id, location_id } = req.query;

      if (!course_id || !location_id) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Course ID and Location ID are required' }
        });
      }

      // Query matching PHP course_avails exactly - without DISTINCT
      const [events] = await this.pool.query(`
        SELECT
          ced.course_event_id,
          ced.event_date,
          ced.event_start_time,
          ced.event_end_time,
          ce.booking_limit,
          ce.bookings_done,
          ce.current_locks,
          ce.event_type,
          c.course_name,
          COALESCE(f.freeze_count, 0) as freeze_count
        FROM course_event_dates ced
        JOIN course_events ce ON ced.course_event_id = ce.id
        JOIN courses c ON ce.course_id = c.id
        LEFT JOIN (
          SELECT course_event_id, COUNT(*) as freeze_count
          FROM freeze
          GROUP BY course_event_id
        ) f ON f.course_event_id = ced.course_event_id
        WHERE ce.course_id = ?
          AND ce.location_id = ?
          AND c.status = '1'
          AND ce.status = '1'
          AND ced.event_date > CURDATE()
          AND ced.event_date <= DATE_ADD(CURDATE(), INTERVAL 6 WEEK)
        ORDER BY ced.event_date ASC
      `, [course_id, location_id]);

      if (events.length === 0) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'No availability found' }
        });
      }

      const availability = events.map(event => {
        const availableSpaces = event.booking_limit - event.bookings_done - event.current_locks;
        const isFullyBooked = (event.bookings_done + event.current_locks) >= event.booking_limit;
        const isFrozen = event.freeze_count > 0;

        return {
          date: event.event_date,
          available: !isFullyBooked && !isFrozen,
          available_spaces: Math.max(0, availableSpaces),
          booking_limit: event.booking_limit,
          bookings_done: event.bookings_done,
          current_locks: event.current_locks,
          event_start_time: event.event_start_time,
          event_end_time: event.event_end_time,
          course_event_id: event.course_event_id,
          freeze: isFrozen ? 1 : 0
        };
      });

      res.json({
        success: true,
        data: {
          course_id: parseInt(course_id),
          location_id: parseInt(location_id),
          availability
        }
      });
    } catch (error) {
      console.error('Error fetching course availability:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch course availability' }
      });
    }
  }

  async getNextAvailabilityForCBT(req, res) {
    try {
      const cbtCourseId = 1; // CBT course ID

      // Query to find the next available date for CBT course across all locations
      const [availability] = await this.pool.query(`
        SELECT
          ced.course_event_id,
          DATE_FORMAT(ced.event_date, '%Y-%m-%d') as event_date,
          ced.event_start_time,
          ced.event_end_time,
          ce.booking_limit,
          ce.bookings_done,
          ce.current_locks,
          ce.location_id,
          ce.course_id,
          c.course_name,
          l.id as location_id,
          l.location_name,
          l.address1,
          l.address2,
          l.address3,
          l.address4,
          l.postcode,
          l.latitude,
          l.longitude,
          COALESCE(f.freeze_count, 0) as freeze_count
        FROM course_event_dates ced
        JOIN course_events ce ON ced.course_event_id = ce.id
        JOIN courses c ON ce.course_id = c.id
        JOIN locations l ON ce.location_id = l.id
        LEFT JOIN (
          SELECT course_event_id, COUNT(*) as freeze_count
          FROM freeze
          GROUP BY course_event_id
        ) f ON f.course_event_id = ced.course_event_id
        WHERE ce.course_id = ?
          AND c.is_cbt = 1
          AND c.status = '1'
          AND ce.status = '1'
          AND DATE(ced.event_date) > DATE(NOW())
          AND DATE(ced.event_date) <= DATE_ADD(DATE(NOW()), INTERVAL 6 WEEK)
        ORDER BY ced.event_date ASC, l.location_name ASC
        LIMIT 1
      `, [cbtCourseId]);

      if (availability.length === 0) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'No CBT courses available' }
        });
      }

      const event = availability[0];
      const availableSpaces = event.booking_limit - event.bookings_done - event.current_locks;
      const isFullyBooked = (event.bookings_done + event.current_locks) >= event.booking_limit;
      const isFrozen = event.freeze_count > 0;

      res.json({
        success: true,
        data: {
          course_id: event.course_id,
          course_name: event.course_name,
          location_id: event.location_id,
          location_name: event.location_name,
          todays_date: new Date().toISOString().split('T')[0],
          address: {
            address1: event.address1,
            address2: event.address2,
            address3: event.address3,
            address4: event.address4,
            postcode: event.postcode
          },
          coordinates: {
            latitude: event.latitude,
            longitude: event.longitude
          },
          next_available: {
            date: event.event_date,
            event_start_time: event.event_start_time,
            event_end_time: event.event_end_time,
            course_event_id: event.course_event_id,
            available: !isFullyBooked && !isFrozen,
            available_spaces: Math.max(0, availableSpaces),
            is_frozen: isFrozen ? 1 : 0
          }
        }
      });
    } catch (error) {
      console.error('Error fetching next CBT availability:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch next CBT availability' }
      });
    }
  }

  async getLocationsByCourse(req, res) {
    try {
      const { course_id } = req.params;

      if (!course_id) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Course ID is required' }
        });
      }

      const [locations] = await this.pool.query(`
        SELECT DISTINCT
          l.id, l.location_name, l.address1, l.address2,
          l.address3, l.address4, l.postcode,
          l.latitude, l.longitude
        FROM course_events ce
        JOIN courses c ON ce.course_id = c.id
        JOIN locations l ON ce.location_id = l.id
        JOIN course_event_dates ced ON ce.id = ced.course_event_id
        WHERE ce.location_id > 0
          AND ce.course_id = ?
          AND ce.status = '1'
          AND ce.booking_limit > 0
          AND c.status = '1'
          AND ced.event_date IS NOT NULL
          AND STR_TO_DATE(ced.event_date, '%Y-%m-%d') IS NOT NULL
          AND ced.event_date > CURDATE()
      `, [course_id]);

      res.json({ success: true, data: locations });
    } catch (error) {
      console.error('Error fetching locations by course:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch locations' }
      });
    }

    try {
      const { courseId, locationId } = req.params;

      const [rows] = await this.pool.query(`
        SELECT vehicle_type_automatic, vehicle_type_manual, vehicle_type_own,
               automatic_lock_done, manual_lock_done
        FROM course_events
        WHERE course_id = ? AND location_id = ? AND status = '1'
      `, [courseId, locationId]);

      if (!rows.length) {
        return res.json({ error: 'No course events found' });
      }

      const event = rows[0];
      const vTypeSelect = {};

      if (event.vehicle_type_automatic > 0 &&
          event.vehicle_type_automatic > event.automatic_lock_done) {
        vTypeSelect['1'] = 'Automatic';
      }

      if (event.vehicle_type_manual > 0 &&
          event.vehicle_type_manual > event.manual_lock_done) {
        vTypeSelect['0'] = 'Manual';
      }

      if (event.vehicle_type_own == 1) {
        vTypeSelect['3'] = 'I will be using my own vehicle';
      }

      res.json({ vehicleTypes: vTypeSelect });
    } catch (error) {
      console.error('Error fetching vehicle types by course/location:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch vehicle types' }
      });
    }
  }

  async getSettings(req, res) {
    try {
      const [settings] = await this.pool.query(`
        SELECT vat_rate, credit_card_surcharge, booking_bcc
        FROM settings LIMIT 1
      `);

      const settingsData = settings.length > 0 ? {
        vat_rate: parseFloat(settings[0].vat_rate),
        credit_card_surcharge: parseFloat(settings[0].credit_card_surcharge),
        booking_bcc: settings[0].booking_bcc
      } : {
        vat_rate: 0.20,
        credit_card_surcharge: 0.025,
        booking_bcc: "bookings@1stopinstruction.com"
      };

      res.json({ success: true, data: settingsData });
    } catch (error) {
      console.error('Error fetching settings:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch settings' }
      });
    }
  }

  async getVehicleTypesByCourseLocation(req, res) {
    try {
      const { courseId, locationId } = req.params;

      const [rows] = await this.pool.query(`
        SELECT vehicle_type_automatic, vehicle_type_manual, vehicle_type_own,
               automatic_lock_done, manual_lock_done
        FROM course_events
        WHERE course_id = ? AND location_id = ? AND status = '1'
      `, [courseId, locationId]);

      if (!rows.length) {
        return res.json({ error: 'No course events found' });
      }

      const event = rows[0];
      const vTypeSelect = {};

      if (event.vehicle_type_automatic > 0 &&
          event.vehicle_type_automatic > event.automatic_lock_done) {
        vTypeSelect['1'] = 'Automatic';
      }

      if (event.vehicle_type_manual > 0 &&
          event.vehicle_type_manual > event.manual_lock_done) {
        vTypeSelect['0'] = 'Manual';
      }

      if (event.vehicle_type_own == 1) {
        vTypeSelect['3'] = 'I will be using my own vehicle';
      }

      res.json({ vehicleTypes: vTypeSelect });
    } catch (error) {
      console.error('Error fetching vehicle types by course/location:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch vehicle types' }
      });
    }
  }

  async getVehicleTypes(req, res) {
    try {
      const [vehicleTypes] = await this.pool.query(`
        SELECT id, setting_value as type_name, status
        FROM vehicle_fleet_settings
        WHERE setting_type = 'transmission' AND status = 1
        ORDER BY order_no ASC
      `);

      res.json({ success: true, data: vehicleTypes });
    } catch (error) {
      console.error('Error fetching vehicle types:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch vehicle types' }
      });
    }
  }

  async getLicenseTypes(req, res) {
    try {
      const [rows] = await this.pool.query(`
        SELECT id, licence_type
        FROM driving_licence_types
        ORDER BY id
      `);

      const licenceTypeSelect = {};
      rows.forEach(type => {
        licenceTypeSelect[type.id] = type.licence_type;
      });

      res.json({ licenseTypes: licenceTypeSelect });
    } catch (error) {
      console.error('Error fetching license types:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch license types' }
      });
    }
  }

  async processAttendee(req, res) {
    try {
      const attendeeData = { ...req.body };

      // Process license_number (uppercase)
      if (attendeeData.license_number) {
        attendeeData.license_number = attendeeData.license_number.toUpperCase();
      }

      // Process names (title case)
      const toTitleCase = (str) => {
        return str.replace(/\w\S*/g, (txt) =>
          txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
        );
      };

      if (attendeeData.first_name) {
        attendeeData.first_name = toTitleCase(attendeeData.first_name);
      }
      if (attendeeData.sur_name) {
        attendeeData.sur_name = toTitleCase(attendeeData.sur_name);
      }

      // Process contacts (remove spaces)
      ['contact1', 'contact2', 'contact3'].forEach(field => {
        if (attendeeData[field]) {
          attendeeData[field] = attendeeData[field].replace(/\s/g, '');
        }
      });

      // Validate license_type exists
      const [licenseTypes] = await this.pool.query(`
        SELECT id FROM driving_licence_types WHERE id = ?
      `, [attendeeData.license_type]);

      if (!licenseTypes.length) {
        return res.status(400).json({ error: 'Invalid license type' });
      }

      // Validate vehicle_type availability
      const [vehicleAvail] = await this.pool.query(`
        SELECT vehicle_type_automatic, vehicle_type_manual, vehicle_type_own,
               automatic_lock_done, manual_lock_done
        FROM course_events
        WHERE course_id = ? AND location_id = ? AND status = 1
      `, [attendeeData.course_id, attendeeData.location_id]);

      if (!vehicleAvail.length) {
        return res.status(400).json({ error: 'Course not available' });
      }

      const event = vehicleAvail[0];
      const isValidVehicle =
        (attendeeData.vehicle_type === '1' && event.vehicle_type_automatic > event.automatic_lock_done) ||
        (attendeeData.vehicle_type === '0' && event.vehicle_type_manual > event.manual_lock_done) ||
        (attendeeData.vehicle_type === '3' && event.vehicle_type_own === 1);

      if (!isValidVehicle) {
        return res.status(400).json({ error: 'Vehicle type not available' });
      }

      res.json({
        success: true,
        attendee: {
          license_number: attendeeData.license_number,
          license_type: attendeeData.license_type,
          vehicle_type: attendeeData.vehicle_type,
          first_name: attendeeData.first_name,
          sur_name: attendeeData.sur_name,
          contact1: attendeeData.contact1,
          contact2: attendeeData.contact2,
          contact3: attendeeData.contact3,
          email: attendeeData.email,
          theory_number: attendeeData.theory_number
        }
      });
    } catch (error) {
      console.error('Error processing attendee:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to process attendee' }
      });
    }
  }

  async validatePromoCode(req, res) {
    try {
      const { promo_code, course_id, location_id, attendees_count = 1 } = req.body;

      if (!promo_code) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Promo code is required' }
        });
      }

      const [promos] = await this.pool.query(`
        SELECT id, promo_code, promo_description, p_c_amount, p_c_discount_type,
               p_c_course, p_c_course_id, p_c_location, p_c_location_id,
               p_c_min_booking, p_c_expiry, p_c_expiry_date, p_c_active_between,
               p_c_active_from_date, p_c_active_to_date, status
        FROM promos
        WHERE promo_code = ? AND status = 1 AND isDeleted = 0
      `, [promo_code]);

      if (promos.length === 0) {
        return res.json({
          success: true,
          data: { valid: false, discount_amount: 0, discount_type: null, description: 'Invalid promo code' }
        });
      }

      const promo = promos[0];
      const currentDate = new Date().toISOString().split('T')[0];

      if (promo.p_c_expiry === 1 && promo.p_c_expiry_date < currentDate) {
        return res.json({
          success: true,
          data: { valid: false, discount_amount: 0, discount_type: null, description: 'Promo code has expired' }
        });
      }

      if (promo.p_c_active_between === 0) {
        if (currentDate < promo.p_c_active_from_date || currentDate > promo.p_c_active_to_date) {
          return res.json({
            success: true,
            data: { valid: false, discount_amount: 0, discount_type: null, description: 'Promo code is not active' }
          });
        }
      }

      if (promo.p_c_course === 0 && course_id && promo.p_c_course_id != course_id) {
        return res.json({
          success: true,
          data: { valid: false, discount_amount: 0, discount_type: null, description: 'Promo code not valid for this course' }
        });
      }

      if (promo.p_c_location === 0 && location_id && promo.p_c_location_id != location_id) {
        return res.json({
          success: true,
          data: { valid: false, discount_amount: 0, discount_type: null, description: 'Promo code not valid for this location' }
        });
      }

      if (attendees_count < promo.p_c_min_booking) {
        return res.json({
          success: true,
          data: { valid: false, discount_amount: 0, discount_type: null, description: `Minimum ${promo.p_c_min_booking} bookings required` }
        });
      }

      res.json({
        success: true,
        data: {
          valid: true,
          discount_amount: parseFloat(promo.p_c_amount),
          discount_type: promo.p_c_discount_type,
          description: promo.promo_description
        }
      });
    } catch (error) {
      console.error('Error validating promo code:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to validate promo code' }
      });
    }
  }

  async createBookingWithAttendees(req, res) {
    try {
      const {
        course_id, course_event_id, location_id, selected_date,
        attendees_count, user_details, attendees,
        create_account = false, password = '', lock_id = 0

      } = req.body;

      const connection = await this.pool.getConnection();
      await connection.beginTransaction();

      try {
        let user_id = null;

        if (create_account && password) {
          const bcrypt = require('bcrypt');
          const hashedPassword = await bcrypt.hash(password, 10);

          const [userResult] = await connection.query(`
            INSERT INTO users (first_name, sur_name, email, password, contact1, created, modified)
            VALUES (?, ?, ?, ?, ?, NOW(), NOW())
          `, [
            user_details.first_name, user_details.sur_name, user_details.email,
            hashedPassword, user_details.contact1
          ]);

          user_id = userResult.insertId;
        }

        const [courseData] = await connection.query(`SELECT dsa_fees FROM courses WHERE id = ?`, [course_id]);
        const coursePrice = courseData[0].dsa_fees;
        const totalFees = coursePrice * attendees_count;
        const vatRate = 0.20;
        const vat = totalFees * vatRate;
        const totalAmount = totalFees + vat;

        const [maxBooking] = await connection.query(`SELECT MAX(id) as max_id FROM bookings`);
        const bookingRef = `BK${String((maxBooking[0].max_id || 0) + 1).padStart(6, '0')}`;

        const [bookingResult] = await connection.query(`
          INSERT INTO bookings (course_id, course_event_id, user_id, type_of_book, spaces,
                               payment_due, total_fees, vatrate, vat, total_amount, admin_payment_received, status, lockid, edit_payment_type, created_by, created, modified, edited_booking_id, booking_made_by)
          VALUES (?, ?, ?, 'o', ?, ?, ?, ?, ?, ?, 0, 0, ?, 0, 0, NOW(), NOW(), 0, ?)
        `, [course_id, course_event_id, user_id || 0, attendees_count, totalAmount, totalFees, vatRate, vat, totalAmount, lock_id, user_id || 0]);

        const booking_id = bookingResult.insertId;

        for (let attendee of attendees) {
          await connection.query(`
            INSERT INTO booking_attendees_dropdown (booking_id, booking_ref, first_name, sur_name, contact1, contact2, contact3,
                                                   email, vehicle_type, license_type, license_number, theory_number,
                                                   notes, \`primary\`, created, updated)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
          `, [
            booking_id, bookingRef, attendee.first_name, attendee.sur_name,
            attendee.contact1, attendee.contact2 || '', attendee.contact3 || '', attendee.email,
            attendee.vehicle_type, attendee.license_type, attendee.license_number,
            attendee.theory_number, attendee.notes || '', attendee.primary ? 1 : 0
          ]);
        }

        const paymentToken = `token_${booking_id}_${Date.now()}`;

        await connection.commit();

        res.status(201).json({
          success: true,
          data: {
            booking_id, booking_ref: bookingRef, payment_due: totalAmount,
            total_fees: totalFees, vat, total_amount: totalAmount, payment_token: paymentToken
          }
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Error creating booking with attendees:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to create booking' }
      });
    }
  }
}

module.exports = BookingFlowController;