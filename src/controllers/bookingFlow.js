// src/controllers/bookingFlow.js
const BookingController = require('../controllers/bookings');
const crypto = require('crypto');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { sendBookingConfirmation } = require('../utils/emailService');

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

      // Query without current_locks
      const [events] = await this.pool.query(`
        SELECT
          ced.course_event_id,
          ced.event_date,
          ced.event_start_time,
          ced.event_end_time,
          ce.booking_limit,
          ce.bookings_done,
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
          AND ce.bookings_done < ce.booking_limit
          AND ced.event_date > CURDATE()
          AND ced.event_date <= DATE_ADD(CURDATE(), INTERVAL 3 MONTH)
        ORDER BY ced.event_date ASC
      `, [course_id, location_id]);

      if (events.length === 0) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'No availability found' }
        });
      }

      const availability = events.map(event => {
        const availableSpaces = event.booking_limit - event.bookings_done;
        const isFullyBooked = event.bookings_done >= event.booking_limit;
        const isFrozen = event.freeze_count > 0;

        return {
          date: event.event_date,
          available: !isFullyBooked && !isFrozen,
          available_spaces: Math.max(0, availableSpaces),
          booking_limit: event.booking_limit,
          bookings_done: event.bookings_done,
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

      const [availability] = await this.pool.query(`
        SELECT
          ced.course_event_id,
          DATE_FORMAT(ced.event_date, '%Y-%m-%d') as event_date,
          ced.event_start_time,
          ced.event_end_time,
          ce.booking_limit,
          ce.bookings_done,
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
          AND DATE(ced.event_date) <= DATE_ADD(DATE(NOW()), INTERVAL 3 MONTH)
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
      const availableSpaces = event.booking_limit - event.bookings_done;
      const isFullyBooked = event.bookings_done >= event.booking_limit;
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
        booking_bcc: "bookings.testds@yopmail.com"
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

  // Decrypt AES encrypted password from frontend (CryptoJS format)
  decryptPassword(encryptedPassword) {
    if (!encryptedPassword) return null;

    try {
      const CryptoJS = require('crypto-js');
      const secretKey = process.env.AES_SECRET_KEY || 'booking-secret-key-2025';

      const decrypted = CryptoJS.AES.decrypt(encryptedPassword, secretKey);
      const plainPassword = decrypted.toString(CryptoJS.enc.Utf8);

      if (!plainPassword) {
        throw new Error('Decryption failed');
      }

      return plainPassword;
    } catch (error) {
      console.error('Error decrypting password:', error);
      return null;
    }
  }

  // CakePHP 2.10 password hashing for compatibility
  cakephp210Password(password) {
    const salt = 'DYhG93b0qyJuIp4kjlN8ltP9lj0wvniR2G0FgaC9mi';
    return crypto.createHash('sha1').update(salt + password).digest('hex');
  }

  // Generate random password
  generateRandomPassword(length = 12) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
    let password = '';
    for (let i = 0; i < length; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  }

  // Generate professional booking reference: 1ST-BK-240315-A7K9
  generateBookingReference() {
    const date = new Date();
    const yy = date.getFullYear().toString().slice(-2);
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const uniqueCode = crypto.randomBytes(2).toString('hex').toUpperCase();
    return `1ST-BK-${yy}${mm}${dd}-${uniqueCode}`;
  }

  async createBookingWithAttendees(req, res) {

    try {
      const {
        course_id, course_event_id, location_id, selected_date,
        attendees, photocard_confirmed, terms_agreed, promo_code
      } = req.body;

      // Validation
      if (!course_id || !course_event_id || !attendees || !Array.isArray(attendees) || attendees.length === 0) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
      }

      if (!photocard_confirmed) {
        return res.status(400).json({ success: false, message: 'Please confirm that the person attending can present their photocard driving licence on the day of the course' });
      }

      if (!terms_agreed) {
        return res.status(400).json({ success: false, message: 'Please agree to the Terms & Conditions and Privacy Policy' });
      }

      const connection = await this.pool.getConnection();
      await connection.beginTransaction();

      try {
        const attendees_count = attendees.length;
        const userIds = [];
        const generatedPasswords = [];

        // Create user account for each attendee
        for (const attendee of attendees) {
          // Check if user exists
          const [existingUser] = await connection.query(
            `SELECT id FROM users WHERE email = ?`,
            [attendee.email]
          );

          let userId;
          if (existingUser.length > 0) {
            userId = existingUser[0].id;
          } else {
            // Decrypt password if provided (encrypted by frontend)
            let plainPassword;
            let passwordType = 'random';
            if (attendee.password) {
              plainPassword = this.decryptPassword(attendee.password);
              if (!plainPassword) {
                throw new Error(`Invalid encrypted password for ${attendee.email}`);
              }
              passwordType = 'user_chosen';
            } else {
              plainPassword = this.generateRandomPassword();
            }

            const hashedPassword = this.cakephp210Password(plainPassword);

            const [userResult] = await connection.query(`
              INSERT INTO users (first_name, sur_name, email, password, password_type, contact1, contact2, contact3, status, created, modified)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            `, [
              attendee.first_name, attendee.sur_name, attendee.email,
              hashedPassword, passwordType, attendee.contact1 || '', attendee.contact2 || '', attendee.contact3 || '', passwordType === 'user_chosen' ? 1 : 0
            ]);

            userId = userResult.insertId;
            generatedPasswords.push({ email: attendee.email, password: plainPassword, generated: !attendee.password });
          }
          userIds.push(userId);
        }

        // Check availability with row lock to prevent race conditions
        const [event] = await connection.query(`
          SELECT booking_limit, bookings_done FROM course_events WHERE id = ? FOR UPDATE
        `, [course_event_id]);

        if (!event.length) {
          throw new Error('Event not found');
        }

        const availableSpaces = event[0].booking_limit - event[0].bookings_done;
        if (availableSpaces < attendees_count) {
          await connection.rollback();
          connection.release();
          return res.status(400).json({
            success: false,
            message: `Sorry, this course is now fully booked. Only ${availableSpaces} space(s) available, but you requested ${attendees_count}.`,
            available_spaces: availableSpaces
          });
        }



        const [courseData] = await connection.query(`
          SELECT c.dsa_fees, c.course_name, ce.school_one_off_price, ce.own_one_off_price,
                 ce.school_deposit_price, ce.own_deposit_price, ce.school_total_price, ce.own_total_price,
                 ce.is_deposit, c.deposit_days, f.vat as franchise_vat
          FROM courses c
          JOIN course_events ce ON c.id = ce.course_id
          JOIN franchise f ON ce.franchise_id = f.id
          WHERE c.id = ? AND ce.id = ?
        `, [course_id, course_event_id]);

        if (!courseData.length) {
          throw new Error('Course not found');
        }

        // Calculate price for each attendee based on vehicle type
        let totalFees = 0;
        for (const attendee of attendees) {
          const vehicleType = attendee.vehicle_type || 0;
          let attendeePrice = 0;

          // Priority 1: One-off pricing
          if (courseData[0].school_one_off_price > 0 || courseData[0].own_one_off_price > 0) {
            attendeePrice = vehicleType === 3 ? courseData[0].own_one_off_price : courseData[0].school_one_off_price;
          }
          // Priority 2: Deposit + Total pricing
          else if (courseData[0].school_deposit_price > 0 || courseData[0].own_deposit_price > 0) {
            attendeePrice = vehicleType === 3 ? courseData[0].own_total_price : courseData[0].school_total_price;
          }
          // Fallback: DSA fees
          else {
            attendeePrice = courseData[0].dsa_fees;
          }

          totalFees += attendeePrice;
        }

        // Apply promo code discount if provided
        let promoDiscount = 0;
        let promoCodeId = null;
        if (promo_code) {
          const [promos] = await connection.query(`
            SELECT id, p_c_amount, p_c_discount_type
            FROM promos
            WHERE promo_code = ? AND status = 1 AND isDeleted = 0
          `, [promo_code]);

          if (promos.length > 0) {
            const promo = promos[0];
            promoCodeId = promo.id;

            if (promo.p_c_discount_type === 'pounds_off') {
              promoDiscount = attendees_count * promo.p_c_amount;
            } else if (promo.p_c_discount_type === 'percent_off') {
              promoDiscount = (totalFees * promo.p_c_amount) / 100;
            }
          }
        }

        const discountedFees = Math.max(0, totalFees - promoDiscount);

        // Calculate VAT (DSA fees are VAT exempt)
        const vatRate = 0.20;
        let vat = 0;

        if (courseData[0].franchise_vat === 1) {
          const dsaFees = courseData[0].dsa_fees * attendees_count;
          const vatableAmount = discountedFees > dsaFees ? (discountedFees - dsaFees) : 0;
          const vatMultiplier = (100 + (vatRate * 100)) / 100;
          vat = vatableAmount - (vatableAmount / vatMultiplier);
          vat = Math.round(vat * 100) / 100;
        }

        const totalAmount = discountedFees + vat;

        const primaryUserId = userIds[0];

        // Store booking data for webhook processing
        const tempBookingData = {
          course_id,
          course_event_id,
          user_id: primaryUserId,
          spaces: attendees_count,
          total_fees: discountedFees,
          vatrate: vatRate,
          vat,
          total_amount: totalAmount,
          promo_code_id: promoCodeId || 0,
          attendees: attendees.map((att, i) => ({
            ...att,
            user_id: userIds[i],
            is_primary_user: att.is_primary_user || (i === 0 ? 1 : 0),
            date_of_birth: att.date_of_birth || null
          }))
        };

        // Stripe Integration
        const siteUrl = process.env.SITE_URL || 'http://localhost:3001';
        const primaryAttendee = attendees[0];

        try {

          const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(totalAmount * 100),
            currency: 'gbp',
            automatic_payment_methods: { enabled: true },
            metadata: {
              booking_data: JSON.stringify(tempBookingData),
              course_id: course_id.toString(),
              course_event_id: course_event_id.toString(),
              user_id: primaryUserId.toString(),
              attendees_count: attendees_count.toString()
            },
            description: `Course: ${courseData[0]?.course_name || 'Course'} - ${attendees_count} attendee(s)`,
            receipt_email: primaryAttendee.email
          });

          await connection.commit();

          res.status(201).json({
            success: true,
            total_fees: discountedFees,
            promo_discount: promoDiscount,
            vat,
            total_amount: totalAmount,
            client_secret: paymentIntent.client_secret,
            payment_intent_id: paymentIntent.id,
            user_accounts: generatedPasswords
          });
        } catch (stripeError) {
          console.error('Stripe PaymentIntent creation failed:', stripeError);
          await connection.rollback();
          throw new Error('Payment gateway error');
        }
      } catch (error) {
        await connection.rollback();
        console.error('Transaction rolled back due to error:', error);
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