// src/controllers/bookingFlow.js
const BookingController = require('../controllers/bookings');
const crypto = require('crypto');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { sendBookingConfirmation } = require('../utils/emailService');
const { replaceTokens } = require('../utils/tokenReplacer');
const e = require('express');

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
            c.description,
            0 as isVoucher
        FROM courses c
        JOIN course_events ce
            ON c.id = ce.course_id
        JOIN course_event_dates ced
            ON ce.id = ced.course_event_id
        WHERE c.status = '1'
        AND c.isDeleted = '0'
        AND ce.status = '1'
        AND ce.booking_limit > 0
        AND ce.booking_limit > ce.bookings_done
        AND ced.event_date > CURDATE()
        AND ced.event_date <= DATE_ADD(CURDATE(), INTERVAL 3 MONTH)
        ORDER BY c.course_name;
      `);

      const formattedCourses = await Promise.all(courses.map(async course => ({
        id: course.id,
        course_name: course.course_name,
        course_abb: course.course_abb,
        duration: course.duration,
        school_one_off_price: parseFloat(course.school_one_off_price),
        is_cbt: course.is_cbt,
        status: course.status,
        isVoucher: Boolean(course.isVoucher),
        description: await replaceTokens(this.pool, course.description)
      })));

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

      // Get all course event dates with availability info
      const [events] = await this.pool.query(`
        SELECT
          ced.course_event_id,
          DATE_FORMAT(ced.event_date, '%Y-%m-%d') as event_date,
          TIME_FORMAT(ced.event_start_time, '%H:%i') as event_start_time,
          TIME_FORMAT(ced.event_end_time, '%H:%i') as event_end_time,
          ced.freeze,
          ce.booking_limit,
          ce.bookings_done,
          ce.current_locks,
          ce.event_type,
          ce.is_deposit,
          ce.vehicle_type_manual,
          ce.vehicle_type_automatic,
          ce.vehicle_type_own,
          ce.school_one_off_price,
          ce.school_deposit_price,
          ce.school_total_price,
          ce.own_one_off_price,
          ce.own_deposit_price,
          ce.own_total_price,
          c.course_name,
          c.deposit_days,
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
          AND ce.booking_limit > ce.bookings_done
          AND ced.course_event_id IN (
            SELECT DISTINCT course_event_id
            FROM course_event_dates
            WHERE event_date > CURDATE()
              AND event_date <= DATE_ADD(CURDATE(), INTERVAL 3 MONTH)
              AND event_date != '1111-11-11'
          )
        ORDER BY ced.event_date ASC, ced.event_start_time ASC
      `, [course_id, location_id]);

      if (events.length === 0) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'No availability found' }
        });
      }

      // Group dates by course_event_id to get multi-day courses
      const groupedEvents = {};
      events.forEach(event => {
        const eventId = event.course_event_id;
        if (!groupedEvents[eventId]) {
          groupedEvents[eventId] = {
            course_event_id: eventId,
            course_name: event.course_name,
            booking_limit: event.booking_limit,
            bookings_done: event.bookings_done,
            current_locks: event.current_locks || 0,
            is_deposit: event.is_deposit,
            vehicle_type_manual: event.vehicle_type_manual,
            vehicle_type_automatic: event.vehicle_type_automatic,
            vehicle_type_own: event.vehicle_type_own,
            school_one_off_price: event.school_one_off_price,
            school_deposit_price: event.school_deposit_price,
            school_total_price: event.school_total_price,
            own_one_off_price: event.own_one_off_price,
            own_deposit_price: event.own_deposit_price,
            own_total_price: event.own_total_price,
            deposit_days: event.deposit_days,
            dates: []
          };
        }

        // Check for TBC dates (either 0000-00-00 or 1111-11-11)
        const isTBC = event.event_date === '0000-00-00' || event.event_date === '1111-11-11';

        groupedEvents[eventId].dates.push({
          event_date: event.event_date, // Keep original for sorting
          display_date: isTBC ? 'TBC' : event.event_date,
          event_start_time: isTBC ? null : event.event_start_time,
          event_end_time: isTBC ? null : event.event_end_time,
          is_tbc: isTBC,
          freeze: event.freeze,
          freeze_count: event.freeze_count
        });
      });

      // Build calendar data with "X Day Course" logic
      const availability = [];
      Object.values(groupedEvents).forEach(eventGroup => {

        const availableSpaces = eventGroup.booking_limit - eventGroup.bookings_done - eventGroup.current_locks;
        const isFullyBooked = (eventGroup.bookings_done + eventGroup.current_locks) >= eventGroup.booking_limit;

        // Sort dates: real dates chronologically first, then TBC dates at the end
        const sortedDates = eventGroup.dates.sort((a, b) => {
          // TBC dates go to the end
          if (a.is_tbc && !b.is_tbc) return 1;
          if (!a.is_tbc && b.is_tbc) return -1;
          // Both TBC or both real - sort by date
          if (a.event_date < b.event_date) return -1;
          if (a.event_date > b.event_date) return 1;
          return 0;
        });

        // Find first non-TBC date for calendar display
        const firstRealDate = sortedDates.find(d => !d.is_tbc) || sortedDates[0];
        const isFrozen = firstRealDate.freeze === 1 || firstRealDate.freeze_count > 0;

        // Calculate number of days for this course
        const numberOfDays = sortedDates.length;

        // Build pricing object based on which pricing fields are configured
        const pricing = {
          vehicle_options: {
            school_vehicle_available: eventGroup.vehicle_type_manual > 0 || eventGroup.vehicle_type_automatic > 0,
            own_vehicle_available: eventGroup.vehicle_type_own === 1
          }
        };

        // Priority 1: Check if one-off pricing is configured
        const hasOneOffPricing = (eventGroup.school_one_off_price > 0) || (eventGroup.own_one_off_price > 0);

        // Priority 2: Check if deposit pricing is configured
        const hasDepositPricing = (eventGroup.school_deposit_price > 0) || (eventGroup.own_deposit_price > 0);

        // === Deposit eligibility calculation based on deposit_days ===
        const depositDays = Number.parseInt(eventGroup.deposit_days) || 0;
        const isDepositEnabled = eventGroup.is_deposit === 1;
        let depositAvailable = false;
        let depositNote = null;

        if (isDepositEnabled && depositDays > 0) {
          // Get the earliest non-TBC date to check against deposit_days
          const firstNonTBCDate = sortedDates.find(d => !d.is_tbc);
          if (firstNonTBCDate) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const courseStartDate = new Date(firstNonTBCDate.event_date);
            courseStartDate.setHours(0, 0, 0, 0);
            const diffTime = courseStartDate.getTime() - today.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays > depositDays) {
              depositAvailable = true;
            } else {
              depositNote = `Deposit option is only available when booking at least ${depositDays} days before the course start date. Full payment is required for this date.`;
            }
          } else {
            // All dates are TBC, cannot determine eligibility
            depositNote = 'Deposit option is unavailable as the course dates are yet to be confirmed.';
          }
        } else if (!isDepositEnabled) {
          // is_deposit is unchecked — deposit period check disabled, always allow deposit if pricing exists
          depositAvailable = true;
        }

        if (hasOneOffPricing) {
          // One-off pricing mode (full payment only)
          pricing.pricing_mode = 'one_off';
          pricing.deposit_period_check_enabled = isDepositEnabled;
          pricing.deposit_available = false; // One-off means full payment only
          pricing.deposit_days = depositDays;
          pricing.deposit_note = 'This course requires full payment.';
          pricing.school_vehicle = {
            price: parseFloat(eventGroup.school_one_off_price) || 0,
            pricing_type: 'one_off'
          };
          pricing.own_vehicle = {
            price: parseFloat(eventGroup.own_one_off_price) || 0,
            pricing_type: 'one_off'
          };
        } else if (hasDepositPricing) {
          // Deposit pricing mode (deposit + balance)
          pricing.pricing_mode = 'deposit';
          pricing.deposit_period_check_enabled = isDepositEnabled;
          pricing.deposit_available = depositAvailable;
          pricing.deposit_days = depositDays;
          pricing.deposit_note = depositNote;
          pricing.school_vehicle = {
            deposit: parseFloat(eventGroup.school_deposit_price) || 0,
            total: parseFloat(eventGroup.school_total_price) || 0,
            pricing_type: 'deposit'
          };
          pricing.own_vehicle = {
            deposit: parseFloat(eventGroup.own_deposit_price) || 0,
            total: parseFloat(eventGroup.own_total_price) || 0,
            pricing_type: 'deposit'
          };
        } else {
          // No pricing configured
          pricing.pricing_mode = 'none';
          pricing.deposit_period_check_enabled = false;
          pricing.deposit_available = false;
          pricing.deposit_days = 0;
          pricing.deposit_note = null;
          pricing.school_vehicle = {
            price: 0,
            pricing_type: 'none'
          };
          pricing.own_vehicle = {
            price: 0,
            pricing_type: 'none'
          };
        }

        availability.push({
          date: firstRealDate.display_date, // Show first date on calendar
          event_start_time: firstRealDate.event_start_time,
          event_end_time: firstRealDate.event_end_time,
          course_event_id: eventGroup.course_event_id,
          course_name: eventGroup.course_name,
          number_of_days: numberOfDays, // For "X Day Course"
          pricing: pricing, // Complete pricing information
          all_dates: sortedDates.map((d, index) => ({
            day_number: index + 1, // Day 1, Day 2, etc. (after sorting)
            event_date: d.display_date, // 'TBC' or 'YYYY-MM-DD'
            event_start_time: d.event_start_time,
            event_end_time: d.event_end_time,
            is_tbc: d.is_tbc
          })), // All dates with times for this event
          available: !isFullyBooked && !isFrozen,
          available_spaces: Math.max(0, availableSpaces),
          booking_limit: eventGroup.booking_limit,
          bookings_done: eventGroup.bookings_done,
          current_locks: eventGroup.current_locks,
          freeze: isFrozen ? 1 : 0,
          status: isFullyBooked ? 'fully_booked' : (availableSpaces > 0 ? 'available' : 'not_available')
        });
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
      const pageId = 9; // Homepage page_id

      // Fetch the course ID from pageSliders table
      const [sliderData] = await this.pool.query(`
        SELECT page_course_id
        FROM pageSliders
        WHERE page_id = ? AND page_course_id IS NOT NULL
        LIMIT 1
      `, [pageId]);

      if (!sliderData.length || !sliderData[0].page_course_id) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'No course configured for next availability' }
        });
      }

      const courseId = sliderData[0].page_course_id;

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
          AND c.status = '1'
          AND ce.status = '1'
          AND DATE(ced.event_date) > DATE(NOW())
          AND DATE(ced.event_date) <= DATE_ADD(DATE(NOW()), INTERVAL 3 MONTH)
          AND (ce.booking_limit - ce.bookings_done - COALESCE(ce.current_locks, 0)) > 0
          AND COALESCE(f.freeze_count, 0) = 0
        ORDER BY ced.event_date ASC, l.location_name ASC
        LIMIT 1
      `, [courseId]);

      if (availability.length === 0) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'No courses available for the configured course' }
        });
      }

      const event = availability[0];
      const availableSpaces = event.booking_limit - event.bookings_done - (event.current_locks || 0);
      const isFullyBooked = (event.bookings_done + (event.current_locks || 0)) >= event.booking_limit;
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
          AND ce.booking_limit > ce.bookings_done
          AND c.status = '1'
          AND ced.event_date IS NOT NULL
          AND STR_TO_DATE(ced.event_date, '%Y-%m-%d') IS NOT NULL
          AND ced.event_date > CURDATE()
          AND ced.event_date <= DATE_ADD(CURDATE(), INTERVAL 3 MONTH)
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
        credit_card_surcharge: 0.0125,
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
      const { courseId, locationId, courseEventId } = req.params;

      const [rows] = await this.pool.query(`
        SELECT vehicle_type_automatic, vehicle_type_manual, vehicle_type_own
        FROM course_events
        WHERE course_id = ? AND location_id = ? AND id   = ? AND status = '1'
      `, [courseId, locationId, courseEventId]);

      if (!rows.length) {
        return res.json({ error: 'No course events found' });
      }

      const event = rows[0];
      const [vehicleUsageRows] = await this.pool.query(`
        SELECT
          SUM(CASE WHEN ba.vehicle_type = 0 THEN 1 ELSE 0 END) AS manual_used,
          SUM(CASE WHEN ba.vehicle_type = 1 THEN 1 ELSE 0 END) AS automatic_used
        FROM booking_attendees ba
        INNER JOIN bookings b ON b.id = ba.booking_id
        WHERE b.course_event_id = ?
          AND b.status IN (0, 1, 2)
      `, [courseEventId]);

      const manualUsed = Number(vehicleUsageRows?.[0]?.manual_used || 0);
      const automaticUsed = Number(vehicleUsageRows?.[0]?.automatic_used || 0);
      const manualAvailable = Math.max(0, Number(event.vehicle_type_manual || 0) - manualUsed);
      const automaticAvailable = Math.max(0, Number(event.vehicle_type_automatic || 0) - automaticUsed);

      const vTypeSelect = {};

      if (automaticAvailable > 0) {
        vTypeSelect['1'] = 'Automatic';
      }

      if (manualAvailable > 0) {
        vTypeSelect['0'] = 'Manual';
      }

      if (Number(event.vehicle_type_own) === 1) {
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
        Where status = 1
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
      const {
        promo_code,
        course_id,
        franchise_id,
        location_id,
        attendees_count = 1,
        booking_date,
        selected_date
      } = req.body;

      if (!promo_code) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Promo code is required' }
        });
      }

      const [promos] = await this.pool.query(`
        SELECT id, promo_code, promo_description, p_c_amount, p_c_discount_type,
               p_c_course, p_c_course_id,
               p_c_franchise, p_c_franchise_id,
               p_c_location, p_c_location_id,
               p_c_min_booking, p_c_for,
               p_c_days, p_c_day,
               p_c_expiry, p_c_expiry_date,
               p_c_active_between, p_c_active_from_date, p_c_active_to_date,
               p_c_dates_between, p_c_from_date, p_c_to_date,
               status, isDeleted
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

      // Validate expiry date
      if (promo.p_c_expiry === 1 && promo.p_c_expiry_date) {
        const expiryDate = new Date(promo.p_c_expiry_date).toISOString().split('T')[0];
        if (currentDate > expiryDate) {
          return res.json({
            success: true,
            data: { valid: false, discount_amount: 0, discount_type: null, description: 'Promo code has expired' }
          });
        }
      }

      // Validate active date range (activation window)
      if (promo.p_c_active_between === 0) {
        const activeFrom = promo.p_c_active_from_date ? new Date(promo.p_c_active_from_date).toISOString().split('T')[0] : null;
        const activeTo = promo.p_c_active_to_date ? new Date(promo.p_c_active_to_date).toISOString().split('T')[0] : null;

        if (activeFrom && currentDate < activeFrom) {
          return res.json({
            success: true,
            data: { valid: false, discount_amount: 0, discount_type: null, description: 'Promo code is not yet active' }
          });
        }

        if (activeTo && currentDate > activeTo) {
          return res.json({
            success: true,
            data: { valid: false, discount_amount: 0, discount_type: null, description: 'Promo code activation period has ended' }
          });
        }
      }

      // Validate booking date range (applicable event dates)
      if (promo.p_c_dates_between === 0) {
        const eventDate = booking_date || selected_date;
        if (eventDate) {
          const dateFrom = promo.p_c_from_date ? new Date(promo.p_c_from_date).toISOString().split('T')[0] : null;
          const dateTo = promo.p_c_to_date ? new Date(promo.p_c_to_date).toISOString().split('T')[0] : null;

          if (dateFrom && eventDate < dateFrom) {
            return res.json({
              success: true,
              data: { valid: false, discount_amount: 0, discount_type: null, description: 'Promo code not valid for this booking date' }
            });
          }

          if (dateTo && eventDate > dateTo) {
            return res.json({
              success: true,
              data: { valid: false, discount_amount: 0, discount_type: null, description: 'Promo code not valid for this booking date' }
            });
          }
        }
      }

      // Validate day of week
      if (promo.p_c_days === 0 && promo.p_c_day) {
        const eventDate = booking_date || selected_date;
        if (eventDate) {
          const dayOfWeek = new Date(eventDate).toLocaleDateString('en-US', { weekday: 'long' });
          const allowedDays = promo.p_c_day.split(',').map(d => d.trim().toLowerCase());
          if (!allowedDays.includes(dayOfWeek.toLowerCase())) {
            return res.json({
              success: true,
              data: { valid: false, discount_amount: 0, discount_type: null, description: `Promo code only valid on ${promo.p_c_day}` }
            });
          }
        }
      }

      // Validate course restriction
      if (promo.p_c_course === 0 && course_id && promo.p_c_course_id != course_id) {
        return res.json({
          success: true,
          data: { valid: false, discount_amount: 0, discount_type: null, description: 'Promo code not valid for this course' }
        });
      }

      // Validate franchise restriction
      if (promo.p_c_franchise === 0 && franchise_id && promo.p_c_franchise_id != franchise_id) {
        return res.json({
          success: true,
          data: { valid: false, discount_amount: 0, discount_type: null, description: 'Promo code not valid for this franchise' }
        });
      }

      // Validate location restriction
      if (promo.p_c_location === 0 && location_id && promo.p_c_location_id != location_id) {
        return res.json({
          success: true,
          data: { valid: false, discount_amount: 0, discount_type: null, description: 'Promo code not valid for this location' }
        });
      }

      // Validate minimum booking requirement
      if (promo.p_c_min_booking && attendees_count < promo.p_c_min_booking) {
        return res.json({
          success: true,
          data: { valid: false, discount_amount: 0, discount_type: null, description: `Minimum ${promo.p_c_min_booking} booking(s) required` }
        });
      }

      // Validate p_c_for - existing customers only check
      if (promo.p_c_for !== 'anyone') {
        // If license_numbers array is provided, validate existing customers
        const { license_numbers } = req.body;

        if (!license_numbers || !Array.isArray(license_numbers) || license_numbers.length === 0) {
          return res.json({
            success: true,
            data: { valid: false, discount_amount: 0, discount_type: null, description: 'Promo code is only valid for existing customers' }
          });
        }

        // Check if ALL license numbers have previous bookings
        for (const license of license_numbers) {
          if (!license || license.trim() === '') {
            continue; // Skip empty licenses
          }

          const [bookings] = await this.pool.query(`
            SELECT COUNT(*) as count FROM booking_attendees
            WHERE license_number = ?
          `, [license.trim()]);

          if (bookings[0].count === 0) {
            // At least one attendee is a new customer
            return res.json({
              success: true,
              data: { valid: false, discount_amount: 0, discount_type: null, description: 'Promo code is only valid for existing customers' }
            });
          }
        }
      }

      // All validations passed
      res.json({
        success: true,
        data: {
          valid: true,
          discount_amount: parseFloat(promo.p_c_amount),
          discount_type: promo.p_c_discount_type,
          description: promo.promo_description,
          promo_code_id: promo.id,
          restrictions: {
            course_specific: promo.p_c_course === 0,
            franchise_specific: promo.p_c_franchise === 0,
            location_specific: promo.p_c_location === 0,
            min_bookings: promo.p_c_min_booking,
            day_restrictions: promo.p_c_days === 0 ? promo.p_c_day : null,
            existing_customers_only: promo.p_c_for !== 'anyone'
          }
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

  /**
   * Validates whether a deposit payment is still eligible at booking-creation time.
   * Returns { eligible: true } or { eligible: false, reason } when the cutoff has passed.
   * Mirrors the frontend resolvePaymentType() logic so both layers agree.
   */
  validateDepositEligibility(courseEvent, eventDates) {
    const hasDepositPricing =
      (Number.parseFloat(courseEvent.school_deposit_price) || 0) > 0 ||
      (Number.parseFloat(courseEvent.own_deposit_price) || 0) > 0;

    if (!hasDepositPricing) {
      return { eligible: false, reason: 'No deposit pricing configured' };
    }

    const isDepositEnabled = Number(courseEvent.is_deposit) === 1;
    const depositDays = Number.parseInt(courseEvent.deposit_days, 10) || 0;

    // Period check disabled — deposit always allowed when pricing exists
    if (!isDepositEnabled) {
      return { eligible: true };
    }

    if (depositDays <= 0) {
      return { eligible: false, reason: 'Deposit period not configured' };
    }

    const validDates = (eventDates || [])
      .map(d => d.event_date)
      .filter(d => d && d !== '1111-11-11' && d !== '0000-00-00')
      .sort();

    if (validDates.length === 0) {
      return { eligible: false, reason: 'Course dates are not yet confirmed' };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const firstDate = new Date(validDates[0]);
    firstDate.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((firstDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays <= depositDays) {
      return {
        eligible: false,
        reason: `This course requires full payment as the course start date is too soon (${diffDays} day(s) away, minimum ${depositDays} required for deposit).`,
      };
    }

    return { eligible: true };
  }

  shouldChargeDeposit(courseEvent, eventDates) {
    const hasDepositPricing =
      (Number.parseFloat(courseEvent.school_deposit_price) || 0) > 0 ||
      (Number.parseFloat(courseEvent.own_deposit_price) || 0) > 0;

    if (!hasDepositPricing) {
      return false;
    }

    const isDepositEnabled = Number(courseEvent.is_deposit) === 1;
    const depositDays = Number.parseInt(courseEvent.deposit_days, 10) || 0;

    // If period check is disabled, allow deposit whenever deposit pricing exists
    if (!isDepositEnabled) {
      return true;
    }

    // If period check is enabled but deposit_days is missing/invalid, default to full payment
    if (depositDays <= 0) {
      return false;
    }

    const validDates = (eventDates || [])
      .map(d => d.event_date)
      .filter(d => d && d !== '1111-11-11' && d !== '0000-00-00')
      .sort();

    if (validDates.length === 0) {
      return false;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const firstDate = new Date(validDates[0]);
    firstDate.setHours(0, 0, 0, 0);

    const diffTime = firstDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return diffDays > depositDays;
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
          SELECT booking_limit, bookings_done, current_locks,
                 vehicle_type_manual, vehicle_type_automatic, vehicle_type_own
          FROM course_events
          WHERE id = ?
          FOR UPDATE
        `, [course_event_id]);

        if (!event.length) {
          throw new Error('Event not found');
        }

        const currentLocks = event[0].current_locks || 0;
        const availableSpaces = event[0].booking_limit - event[0].bookings_done - currentLocks;
        if (availableSpaces < attendees_count) {
          await connection.rollback();
          connection.release();
          return res.status(400).json({
            success: false,
            message: `Sorry, this course is now fully booked. Only ${availableSpaces} space(s) available, but you requested ${attendees_count}.`,
            available_spaces: availableSpaces
          });
        }

        // Validate vehicle-type capacity for this specific event
        const requestedVehicleCounts = attendees.reduce((acc, attendee) => {
          const vehicleType = Number.parseInt(attendee.vehicle_type, 10);
          if (vehicleType === 0) acc.manual += 1;
          if (vehicleType === 1) acc.automatic += 1;
          if (vehicleType === 3) acc.own += 1;
          return acc;
        }, { manual: 0, automatic: 0, own: 0 });

        if (requestedVehicleCounts.own > 0 && Number(event[0].vehicle_type_own) !== 1) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            message: 'Own-vehicle option is not available for this event.'
          });
        }

        const [vehicleUsageRows] = await connection.query(`
          SELECT
            SUM(CASE WHEN ba.vehicle_type = 0 THEN 1 ELSE 0 END) AS manual_used,
            SUM(CASE WHEN ba.vehicle_type = 1 THEN 1 ELSE 0 END) AS automatic_used
          FROM booking_attendees ba
          INNER JOIN bookings b ON b.id = ba.booking_id
          WHERE b.course_event_id = ?
            AND b.status IN (0, 1, 2)
        `, [course_event_id]);

        const manualUsed = Number(vehicleUsageRows?.[0]?.manual_used || 0);
        const automaticUsed = Number(vehicleUsageRows?.[0]?.automatic_used || 0);

        const manualAvailable = Math.max(0, Number(event[0].vehicle_type_manual || 0) - manualUsed);
        const automaticAvailable = Math.max(0, Number(event[0].vehicle_type_automatic || 0) - automaticUsed);

        if (requestedVehicleCounts.manual > manualAvailable) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            message: `Manual vehicle slots unavailable. Requested ${requestedVehicleCounts.manual}, available ${manualAvailable}. Please reduce manual attendees or choose another vehicle type.`
          });
        }

        if (requestedVehicleCounts.automatic > automaticAvailable) {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            message: `Automatic vehicle slots unavailable. Requested ${requestedVehicleCounts.automatic}, available ${automaticAvailable}. Please reduce automatic attendees or choose another vehicle type.`
          });
        }

        // Increment current_locks to temporarily reserve the spaces (prevents race conditions)
        // bookings_done will be incremented when payment is confirmed via webhook
        await connection.query(`
          UPDATE course_events
          SET current_locks = current_locks + ?
          WHERE id = ?
        `, [attendees_count, course_event_id]);

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

        const [eventDates] = await connection.query(`
          SELECT event_date
          FROM course_event_dates
          WHERE course_event_id = ?
          ORDER BY event_date ASC
        `, [course_event_id]);

        const chargeDepositNow = this.shouldChargeDeposit(courseData[0], eventDates);

        // Server-side deposit cutoff guard — reject if deposit is requested but cutoff has passed
        const hasDepositPricingOnly =
          (courseData[0].school_deposit_price > 0 || courseData[0].own_deposit_price > 0) &&
          !(courseData[0].school_one_off_price > 0 || courseData[0].own_one_off_price > 0);

        // if (hasDepositPricingOnly && !chargeDepositNow) {
        //   const depositCheck = this.validateDepositEligibility(courseData[0], eventDates);
        //   if (!depositCheck.eligible) {
        //     await connection.rollback();
        //     connection.release();
        //     return res.status(400).json({
        //       success: false,
        //       message: depositCheck.reason || 'Deposit payment is not available for this booking date. Full payment is required.',
        //     });
        //   }
        // }

        // Calculate full course fees and initial payable amount separately
        // Track per-attendee amounts for accurate per-booking storage
        const perAttendeeAmounts = [];
        let totalFees = 0;
        let payableNowFees = 0;
        for (const attendee of attendees) {
          const vehicleType = attendee.vehicle_type || 0;
          let attendeeTotalPrice = 0;
          let attendeePayableNow = 0;

          // Priority 1: One-off pricing
          if (courseData[0].school_one_off_price > 0 || courseData[0].own_one_off_price > 0) {
            attendeeTotalPrice = vehicleType === 3 ? courseData[0].own_one_off_price : courseData[0].school_one_off_price;
            attendeePayableNow = attendeeTotalPrice;
          }
          // Priority 2: Deposit + Total pricing (charge deposit only when allowed)
          else if (courseData[0].school_deposit_price > 0 || courseData[0].own_deposit_price > 0) {
            const attendeeDeposit = vehicleType === 3 ? courseData[0].own_deposit_price : courseData[0].school_deposit_price;
            const attendeeConfiguredTotal = vehicleType === 3 ? courseData[0].own_total_price : courseData[0].school_total_price;

            attendeeTotalPrice = attendeeConfiguredTotal > 0 ? attendeeConfiguredTotal : attendeeDeposit;
            attendeePayableNow = chargeDepositNow ? attendeeDeposit : attendeeTotalPrice;
          }
          // Fallback: DSA fees
          else {
            attendeeTotalPrice = courseData[0].dsa_fees;
            attendeePayableNow = attendeeTotalPrice;
          }

          totalFees += Number(attendeeTotalPrice) || 0;
          payableNowFees += Number(attendeePayableNow) || 0;
          perAttendeeAmounts.push({ total: Number(attendeeTotalPrice) || 0, payableNow: Number(attendeePayableNow) || 0 });
        }

        const roundCurrency = (value) => Math.round((Number(value) || 0) * 100) / 100;
        const allocateProportionalAmounts = (baseAmounts, totalAllocation) => {
          const normalizedBases = baseAmounts.map((amount) => Math.max(0, roundCurrency(amount)));
          const totalBase = roundCurrency(normalizedBases.reduce((sum, amount) => sum + amount, 0));
          const cappedAllocation = Math.min(roundCurrency(totalAllocation), totalBase);

          if (cappedAllocation <= 0 || totalBase <= 0) {
            return normalizedBases.map(() => 0);
          }

          let remainingAllocation = cappedAllocation;
          let remainingBase = totalBase;

          return normalizedBases.map((baseAmount, index) => {
            if (baseAmount <= 0) {
              return 0;
            }

            if (index === normalizedBases.length - 1) {
              return roundCurrency(Math.min(baseAmount, remainingAllocation));
            }

            const proportionalShare = remainingBase > 0
              ? roundCurrency((remainingAllocation * baseAmount) / remainingBase)
              : 0;
            const allocatedAmount = Math.min(baseAmount, proportionalShare);

            remainingAllocation = roundCurrency(remainingAllocation - allocatedAmount);
            remainingBase = roundCurrency(remainingBase - baseAmount);

            return allocatedAmount;
          });
        };

        // Apply promo code discount if provided
        let promoDiscountOnTotal = 0;
        let promoDiscountOnPayableNow = 0;
        let promoCodeId = null;
        let promoDiscountsPerAttendeeTotal = perAttendeeAmounts.map(() => 0);
        let promoDiscountsPerAttendeePayableNow = perAttendeeAmounts.map(() => 0);
        if (promo_code) {
          const [promos] = await connection.query(`
            SELECT id, p_c_amount, p_c_discount_type
            FROM promos
            WHERE promo_code = ? AND status = 1 AND isDeleted = 0
          `, [promo_code]);

          if (promos.length > 0) {
            const promo = promos[0];
            promoCodeId = promo.id;
            const promoAmount = Number(promo.p_c_amount) || 0;

            if (promo.p_c_discount_type === 'pounds_off') {
              promoDiscountsPerAttendeeTotal = perAttendeeAmounts.map(({ total }) => Math.min(roundCurrency(total), promoAmount));
              promoDiscountsPerAttendeePayableNow = perAttendeeAmounts.map(({ payableNow }) => Math.min(roundCurrency(payableNow), promoAmount));

              promoDiscountOnTotal = roundCurrency(
                promoDiscountsPerAttendeeTotal.reduce((sum, amount) => sum + amount, 0)
              );
              promoDiscountOnPayableNow = roundCurrency(
                promoDiscountsPerAttendeePayableNow.reduce((sum, amount) => sum + amount, 0)
              );
            } else if (promo.p_c_discount_type === 'percent_off') {
              promoDiscountOnTotal = roundCurrency((totalFees * promoAmount) / 100);
              promoDiscountOnPayableNow = roundCurrency((payableNowFees * promoAmount) / 100);
              promoDiscountsPerAttendeeTotal = allocateProportionalAmounts(
                perAttendeeAmounts.map(({ total }) => total),
                promoDiscountOnTotal
              );
              promoDiscountsPerAttendeePayableNow = allocateProportionalAmounts(
                perAttendeeAmounts.map(({ payableNow }) => payableNow),
                promoDiscountOnPayableNow
              );
            }
          }
        }

        const discountedTotalFees = Math.max(0, totalFees - promoDiscountOnTotal);
        const discountedPayableNowFees = Math.max(0, payableNowFees - promoDiscountOnPayableNow);

        // VAT disabled for current booking flow
        const vatRate = 0;
        const vat = 0;

        const totalAmount = discountedTotalFees + vat;

        const hasDepositPricing =
          (courseData[0].school_deposit_price > 0 || courseData[0].own_deposit_price > 0) &&
          !(courseData[0].school_one_off_price > 0 || courseData[0].own_one_off_price > 0);

        // Deposit flow charges deposit now; one-off/full flow charges full total now
        const amountToChargeNow = hasDepositPricing && chargeDepositNow
          ? discountedPayableNowFees
          : totalAmount;

        // Use first attendee's user_id as primary booking user
        const primaryUserId = userIds[0];

        // Each attendee gets their own booking row and unique booking ref
        const bookingIds = [];
        const bookingRefs = [];

        const discountedPerAttendeeNetTotals = perAttendeeAmounts.map(({ total }, index) =>
          roundCurrency(Math.max(0, total - (promoDiscountsPerAttendeeTotal[index] || 0)))
        );
        const discountedPerAttendeePayableNow = perAttendeeAmounts.map(({ payableNow }, index) =>
          roundCurrency(Math.max(0, payableNow - (promoDiscountsPerAttendeePayableNow[index] || 0)))
        );
        const perAttendeeVatableNet = discountedPerAttendeeNetTotals.map(() => 0);
        const perAttendeeVat = allocateProportionalAmounts(perAttendeeVatableNet, vat);

        for (let i = 0; i < attendees.length; i++) {
          const attendee = attendees[i];
          const attendeeUserId = userIds[i];
          const attendeeNetTotal = discountedPerAttendeeNetTotals[i];
          const attendeePayableNow = discountedPerAttendeePayableNow[i];
          const attendeeVat = roundCurrency(perAttendeeVat[i] || 0);
          const attendeeGrossTotal = roundCurrency(attendeeNetTotal + attendeeVat);
          // payment_due = balance still owed after this payment (gross total - amount paid now)
          const attendeePaymentDue = roundCurrency(Math.max(0, attendeeGrossTotal - attendeePayableNow));

          const [bookingResult] = await connection.query(`
            INSERT INTO bookings (course_id, course_event_id, user_id, type_of_book, spaces,
                                 payment_due, total_fees, vatrate, vat, total_amount, admin_payment_received, status, lockid, edit_payment_type, created_by, created, modified, edited_booking_id, booking_made_by, is_promo_applied, promo_code_id)
            VALUES (?, ?, ?, 'o', 1, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, NOW(), NOW(), 0, ?, ?, ?)
          `, [course_id, course_event_id, attendeeUserId, attendeePaymentDue, attendeeNetTotal, vatRate, attendeeVat, attendeeGrossTotal, attendeePayableNow, attendeeUserId, attendeeUserId, promoCodeId ? 1 : 0, promoCodeId || 0]);

          const booking_id = bookingResult.insertId;
          const bookingRef = `1SRC${booking_id}`;
          let primaryFlag = 0;
          if (i === 0) {
            primaryFlag = 1;
          }
          bookingIds.push(booking_id);
          bookingRefs.push(bookingRef);

          await connection.query(`
            INSERT INTO booking_attendees (booking_id, booking_ref, first_name, sur_name, contact1, contact2, contact3,
                                         email, vehicle_type, license_type, license_number, theory_number,
                                         admin_notes, notes, contact_card_id, \`primary\`, created)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', 0, ?, NOW())
          `, [
            booking_id, bookingRef, attendee.first_name, attendee.sur_name,
            attendee.contact1 || '', attendee.contact2 || '', attendee.contact3 || '', attendee.email,
            attendee.vehicle_type || 0, attendee.license_type || 0, attendee.license_number || '',
            attendee.theory_number || '', primaryFlag
          ]);

          await connection.query(`
            INSERT INTO booking_attendees_dropdown (booking_id, booking_ref, first_name, sur_name, contact1, contact2, contact3,
                                                   email, vehicle_type, license_type, license_number, theory_number,
                                                   notes, \`primary\`, created, updated)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())
          `, [
            booking_id, bookingRef, attendee.first_name, attendee.sur_name,
            attendee.contact1 || '', attendee.contact2 || '', attendee.contact3 || '', attendee.email,
            String(attendee.vehicle_type || 0), attendee.license_type || 0, attendee.license_number || '',
            attendee.theory_number || '', attendee.notes || ''
          ]);
        }

        const primaryBookingId = bookingIds[0];
        const primaryBookingRef = bookingRefs[0];

        // Stripe Integration
        const primaryAttendee = attendees[0];

        try {
          const formatStripeDate = (dateValue) => {
            if (!dateValue) return '';
            const dateObj = new Date(dateValue);
            if (Number.isNaN(dateObj.getTime())) return '';
            const day = dateObj.getDate();
            const month = dateObj.getMonth() + 1;
            const yearShort = String(dateObj.getFullYear()).slice(-2);
            return `${day}/${month}/${yearShort}`;
          };

          const courseDateText = formatStripeDate(selected_date);
          const attendeeParts = attendees.map((attendee, index) => {
            const fullName = `${attendee.first_name || ''} ${attendee.sur_name || ''}`.trim();
            const attendeeRef = bookingRefs[index] || '';
            return `${fullName} (${attendeeRef})`;
          });

          const attendeeSummary = attendeeParts.join(' & ');
          const stripeDescriptionParts = [
            attendeeSummary,
            '-',
            courseData[0]?.course_name || 'Course',
            courseDateText
          ].filter(Boolean);
          const stripeDescription = stripeDescriptionParts.join(' ').replace(/\s+/g, ' ').trim();

          const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amountToChargeNow * 100),
            currency: 'gbp',
            automatic_payment_methods: { enabled: true },
            metadata: {
              booking_id: primaryBookingId.toString(),
              booking_ref: primaryBookingRef,
              booking_ids: bookingIds.join(','),
              booking_refs: bookingRefs.join(','),
              course_id: course_id.toString(),
              course_event_id: course_event_id.toString(),
              user_id: userIds[0].toString(),
              attendees_count: attendees_count.toString(),
              first_attendee_name: `${primaryAttendee?.first_name || ''} ${primaryAttendee?.sur_name || ''}`.trim(),
              first_attendee_phone: String(primaryAttendee?.contact1 || ''),
              first_attendee_email: String(primaryAttendee?.email || ''),
              first_attendee_driving_licence: String(primaryAttendee?.license_number || ''),
              course_date: courseDateText
            },
            description: stripeDescription,
            receipt_email: attendees[0].email
          });

          await connection.commit();

          res.status(201).json({
            success: true,
            booking_id: primaryBookingId,
            booking_ref: primaryBookingRef,
            booking_ids: bookingIds,
            booking_refs: bookingRefs,
            payment_due: totalAmount,
            total_fees: discountedTotalFees,
            promo_discount: promoDiscountOnTotal,
            vat,
            total_amount: totalAmount,
            amount_to_charge_now: amountToChargeNow,
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