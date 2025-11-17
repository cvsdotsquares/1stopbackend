// src/controllers/courseEvents.js
/**
 * Course Events Controller - handles course scheduling and availability
 */

class CourseEventsController {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Get available course events (schedules)
   */
  async getCourseEvents(req, res) {
    try {
      const {
        course_id,
        location_id,
        date_from,
        date_to,
        status = '1',
        limit = 50,
        offset = 0
      } = req.query;

      let query = `
        SELECT 
          ce.id as event_id,
          ce.course_id,
          ce.location_id,
          ce.booking_limit,
          ce.vehicle_type_manual,
          ce.vehicle_type_automatic,
          ce.vehicle_type_own,
          ce.school_one_off_price,
          ce.school_deposit_price,
          ce.school_total_price,
          ce.own_one_off_price,
          ce.own_deposit_price,
          ce.own_total_price,
          ce.bookings_done,
          ce.current_locks,
          ce.is_deposit,
          ce.status as event_status,
          ce.created,
          ced.id as date_id,
          ced.event_date,
          ced.event_start_time,
          ced.event_end_time,
          ced.freeze,
          c.course_name,
          c.course_abb,
          c.dsa_fees,
          l.location_name,
          l.loc_abb,
          l.address1,
          l.postcode,
          (ce.booking_limit - ce.bookings_done - ce.current_locks) as spaces_available
        FROM course_events ce
        INNER JOIN course_event_dates ced ON ce.id = ced.course_event_id
        INNER JOIN courses c ON ce.course_id = c.id
        INNER JOIN locations l ON ce.location_id = l.id
        WHERE ce.status = ?
          AND c.status = '1'
          AND l.status = '1'
      `;

      const params = [status];

      if (course_id) {
        query += ` AND ce.course_id = ?`;
        params.push(course_id);
      }

      if (location_id) {
        query += ` AND ce.location_id = ?`;
        params.push(location_id);
      }

      if (date_from) {
        query += ` AND ced.event_date >= ?`;
        params.push(date_from);
      }

      if (date_to) {
        query += ` AND ced.event_date <= ?`;
        params.push(date_to);
      }

      // Only show future events by default
      if (!date_from) {
        query += ` AND ced.event_date >= CURDATE()`;
      }

      query += `
        ORDER BY ced.event_date ASC, ced.event_start_time ASC
        LIMIT ? OFFSET ?
      `;
      params.push(parseInt(limit), parseInt(offset));

      const [events] = await this.pool.query(query, params);

      // Group events by course_event_id to show all dates for each event
      const groupedEvents = {};
      events.forEach(event => {
        if (!groupedEvents[event.event_id]) {
          groupedEvents[event.event_id] = {
            event_id: event.event_id,
            course_id: event.course_id,
            location_id: event.location_id,
            course_name: event.course_name,
            course_abb: event.course_abb,
            location_name: event.location_name,
            loc_abb: event.loc_abb,
            address1: event.address1,
            postcode: event.postcode,
            booking_limit: event.booking_limit,
            bookings_done: event.bookings_done,
            current_locks: event.current_locks,
            spaces_available: event.spaces_available,
            vehicle_options: {
              manual: event.vehicle_type_manual,
              automatic: event.vehicle_type_automatic,
              own: event.vehicle_type_own
            },
            pricing: {
              school: {
                one_off: event.school_one_off_price,
                deposit: event.school_deposit_price,
                total: event.school_total_price
              },
              own_vehicle: {
                one_off: event.own_one_off_price,
                deposit: event.own_deposit_price,
                total: event.own_total_price
              }
            },
            is_deposit: event.is_deposit,
            dsa_fees: event.dsa_fees,
            event_status: event.event_status,
            created: event.created,
            dates: []
          };
        }

        groupedEvents[event.event_id].dates.push({
          date_id: event.date_id,
          event_date: event.event_date,
          start_time: event.event_start_time,
          end_time: event.event_end_time,
          freeze: event.freeze
        });
      });

      const result = Object.values(groupedEvents);

      res.json({
        success: true,
        data: {
          events: result,
          pagination: {
            limit: parseInt(limit),
            offset: parseInt(offset),
            has_next: result.length === parseInt(limit)
          }
        }
      });

    } catch (error) {
      console.error('Error fetching course events:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch course events',
        error: error.message
      });
    }
  }

  /**
   * Get course event by ID with full details
   */
  async getCourseEventById(req, res) {
    try {
      const { id } = req.params;

      const [events] = await this.pool.query(`
        SELECT 
          ce.*,
          c.course_name,
          c.course_abb,
          c.description,
          c.dsa_fees,
          c.cancel_price,
          c.cancel_days,
          c.deposit_days,
          l.location_name,
          l.loc_abb,
          l.address1,
          l.address2,
          l.address3,
          l.postcode,
          l.latitude,
          l.longitude,
          l.direction_content,
          (ce.booking_limit - ce.bookings_done - ce.current_locks) as spaces_available
        FROM course_events ce
        INNER JOIN courses c ON ce.course_id = c.id
        INNER JOIN locations l ON ce.location_id = l.id
        WHERE ce.id = ? AND ce.status = '1'
      `, [id]);

      if (events.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Course event not found or inactive'
        });
      }

      // Get all dates for this event
      const [dates] = await this.pool.query(`
        SELECT 
          id as date_id,
          event_date,
          event_start_time,
          event_end_time,
          freeze
        FROM course_event_dates
        WHERE course_event_id = ?
        ORDER BY event_date ASC, event_start_time ASC
      `, [id]);

      // Get existing bookings for this event
      const [bookings] = await this.pool.query(`
        SELECT 
          COUNT(*) as booking_count,
          SUM(spaces) as total_spaces_booked,
          AVG(total_amount) as average_booking_value
        FROM bookings
        WHERE course_event_id = ? AND status = 1
      `, [id]);

      const event = events[0];
      event.dates = dates;
      event.booking_statistics = bookings[0];

      res.json({
        success: true,
        data: event
      });

    } catch (error) {
      console.error('Error fetching course event:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch course event details',
        error: error.message
      });
    }
  }

  /**
   * Get available dates for a specific course and location
   */
  async getAvailableDates(req, res) {
    try {
      const {
        course_id,
        location_id,
        date_from,
        date_to,
        spaces_required = 1
      } = req.query;

      if (!course_id) {
        return res.status(400).json({
          success: false,
          message: 'Course ID is required'
        });
      }

      let query = `
        SELECT 
          ce.id as event_id,
          ced.id as date_id,
          ced.event_date,
          ced.event_start_time,
          ced.event_end_time,
          ce.booking_limit,
          ce.bookings_done,
          ce.current_locks,
          (ce.booking_limit - ce.bookings_done - ce.current_locks) as spaces_available,
          ce.school_one_off_price,
          ce.school_deposit_price,
          ce.school_total_price,
          ce.is_deposit,
          l.location_name,
          l.loc_abb,
          l.address1,
          l.postcode
        FROM course_events ce
        INNER JOIN course_event_dates ced ON ce.id = ced.course_event_id
        INNER JOIN locations l ON ce.location_id = l.id
        WHERE ce.course_id = ?
          AND ce.status = '1'
          AND l.status = '1'
          AND ced.freeze != 1
          AND (ce.booking_limit - ce.bookings_done - ce.current_locks) >= ?
      `;

      const params = [course_id, parseInt(spaces_required)];

      if (location_id) {
        query += ` AND ce.location_id = ?`;
        params.push(location_id);
      }

      if (date_from) {
        query += ` AND ced.event_date >= ?`;
        params.push(date_from);
      } else {
        query += ` AND ced.event_date >= CURDATE()`;
      }

      if (date_to) {
        query += ` AND ced.event_date <= ?`;
        params.push(date_to);
      }

      query += `
        ORDER BY ced.event_date ASC, ced.event_start_time ASC
        LIMIT 100
      `;

      const [availableDates] = await this.pool.query(query, params);

      res.json({
        success: true,
        data: {
          course_id: parseInt(course_id),
          location_id: location_id ? parseInt(location_id) : null,
          spaces_required: parseInt(spaces_required),
          available_dates: availableDates
        }
      });

    } catch (error) {
      console.error('Error fetching available dates:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch available dates',
        error: error.message
      });
    }
  }

  /**
   * Get course event availability calendar
   */
  async getEventCalendar(req, res) {
    try {
      const {
        course_id,
        location_id,
        year = new Date().getFullYear(),
        month = new Date().getMonth() + 1
      } = req.query;

      // Get first and last day of the requested month
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);
      
      const formatDate = (date) => date.toISOString().split('T')[0];

      let query = `
        SELECT 
          ced.event_date,
          COUNT(DISTINCT ce.id) as events_count,
          SUM(ce.booking_limit - ce.bookings_done - ce.current_locks) as total_spaces_available,
          MIN(ce.school_one_off_price) as min_price,
          MAX(ce.school_total_price) as max_price,
          GROUP_CONCAT(DISTINCT l.location_name) as locations
        FROM course_events ce
        INNER JOIN course_event_dates ced ON ce.id = ced.course_event_id
        INNER JOIN locations l ON ce.location_id = l.id
        WHERE ce.status = '1'
          AND l.status = '1'
          AND ced.event_date >= ?
          AND ced.event_date <= ?
          AND ced.freeze != 1
      `;

      const params = [formatDate(startDate), formatDate(endDate)];

      if (course_id) {
        query += ` AND ce.course_id = ?`;
        params.push(course_id);
      }

      if (location_id) {
        query += ` AND ce.location_id = ?`;
        params.push(location_id);
      }

      query += `
        GROUP BY ced.event_date
        ORDER BY ced.event_date ASC
      `;

      const [calendar] = await this.pool.query(query, params);

      res.json({
        success: true,
        data: {
          year: parseInt(year),
          month: parseInt(month),
          calendar_days: calendar,
          filters: {
            course_id: course_id ? parseInt(course_id) : null,
            location_id: location_id ? parseInt(location_id) : null
          }
        }
      });

    } catch (error) {
      console.error('Error fetching event calendar:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch event calendar',
        error: error.message
      });
    }
  }

  /**
   * Check event availability for booking
   */
  async checkAvailability(req, res) {
    try {
      const { event_id, date_id, spaces_required = 1 } = req.query;

      if (!event_id || !date_id) {
        return res.status(400).json({
          success: false,
          message: 'Event ID and Date ID are required'
        });
      }

      const [availability] = await this.pool.query(`
        SELECT 
          ce.id as event_id,
          ced.id as date_id,
          ced.event_date,
          ced.event_start_time,
          ced.event_end_time,
          ced.freeze,
          ce.booking_limit,
          ce.bookings_done,
          ce.current_locks,
          (ce.booking_limit - ce.bookings_done - ce.current_locks) as spaces_available,
          ce.school_one_off_price,
          ce.school_total_price,
          c.course_name,
          l.location_name,
          CASE 
            WHEN ced.freeze = 1 THEN 'frozen'
            WHEN ced.event_date < CURDATE() THEN 'past_date'
            WHEN (ce.booking_limit - ce.bookings_done - ce.current_locks) < ? THEN 'insufficient_spaces'
            ELSE 'available'
          END as availability_status
        FROM course_events ce
        INNER JOIN course_event_dates ced ON ce.id = ced.course_event_id
        INNER JOIN courses c ON ce.course_id = c.id
        INNER JOIN locations l ON ce.location_id = l.id
        WHERE ce.id = ? AND ced.id = ?
      `, [parseInt(spaces_required), event_id, date_id]);

      if (availability.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Event or date not found'
        });
      }

      const result = availability[0];
      result.is_available = result.availability_status === 'available';
      result.spaces_required = parseInt(spaces_required);

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      console.error('Error checking availability:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to check availability',
        error: error.message
      });
    }
  }
}

module.exports = CourseEventsController;