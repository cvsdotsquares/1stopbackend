// src/controllers/courses.js
/**
 * Course Controller - handles course-related operations
 */

class CourseController {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Get all active courses with basic information
   */
  async getCourses(req, res) {
    try {
      const {
        status = '1', // Active courses by default
        limit = 50,
        offset = 0,
        search = ''
      } = req.query;

      let query = `
        SELECT 
          id,
          course_name,
          course_abb,
          SUBSTRING(description, 1, 500) as description_preview,
          dsa_fees,
          default_booking_limit,
          default_start_time,
          default_end_time,
          is_cbt,
          status,
          created
        FROM courses 
        WHERE status = ?
      `;
      
      const params = [status];

      // Add search functionality
      if (search) {
        query += ` AND (course_name LIKE ? OR course_abb LIKE ? OR description LIKE ?)`;
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm);
      }

      query += ` ORDER BY 
        CASE 
          WHEN course_name = 'CBT' THEN 0 
          ELSE 1 
        END,
        course_name ASC
        LIMIT ? OFFSET ?
      `;
      
      params.push(parseInt(limit), parseInt(offset));

      const [courses] = await this.pool.query(query, params);

      // Get total count for pagination
      let countQuery = `SELECT COUNT(*) as total FROM courses WHERE status = ?`;
      const countParams = [status];

      if (search) {
        countQuery += ` AND (course_name LIKE ? OR course_abb LIKE ? OR description LIKE ?)`;
        const searchTerm = `%${search}%`;
        countParams.push(searchTerm, searchTerm, searchTerm);
      }

      const [countResult] = await this.pool.query(countQuery, countParams);
      const total = countResult[0].total;

      res.json({
        success: true,
        data: {
          courses,
          pagination: {
            total,
            limit: parseInt(limit),
            offset: parseInt(offset),
            has_next: (parseInt(offset) + parseInt(limit)) < total,
            has_prev: parseInt(offset) > 0
          }
        }
      });

    } catch (error) {
      console.error('Error fetching courses:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch courses',
        error: error.message
      });
    }
  }

  /**
   * Get course by ID with full details
   */
  async getCourseById(req, res) {
    try {
      const { id } = req.params;

      const [courses] = await this.pool.query(`
        SELECT 
          id,
          course_name,
          course_abb,
          description,
          email_content,
          send_feedback_mail,
          feedback_content,
          reminder_content,
          cancel_price,
          cancel_days,
          deposit_days,
          dsa_fees,
          default_booking_limit,
          default_manual_vehicle,
          default_automatic_vehicle,
          default_start_time,
          default_end_time,
          is_cbt,
          dvsa_email,
          status,
          created,
          modified
        FROM courses 
        WHERE id = ? AND status != '2'
      `, [id]);

      if (courses.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Course not found or inactive'
        });
      }

      const course = courses[0];

      // Get course events (upcoming dates)
      const [events] = await this.pool.query(`
        SELECT 
          ce.id as event_id,
          ce.course_id,
          ce.location_id,
          ced.event_date,
          ced.event_start_time as start_time,
          ced.event_end_time as end_time,
          ce.booking_limit,
          (ce.booking_limit - ce.bookings_done - ce.current_locks) as spaces_available,
          ce.status as event_status,
          l.location_name,
          l.address1,
          l.postcode
        FROM course_events ce
        LEFT JOIN course_event_dates ced ON ce.id = ced.course_event_id
        LEFT JOIN locations l ON ce.location_id = l.id
        WHERE ce.course_id = ? 
          AND ce.status = 1 
          AND ced.event_date >= CURDATE()
        ORDER BY ced.event_date ASC, ced.event_start_time ASC
        LIMIT 10
      `, [id]);

      res.json({
        success: true,
        data: {
          course,
          upcoming_events: events
        }
      });

    } catch (error) {
      console.error('Error fetching course:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch course details',
        error: error.message
      });
    }
  }

  /**
   * Get course statistics
   */
  async getCourseStats(req, res) {
    try {
      const { id } = req.params;

      // Get course statistics
      const [stats] = await this.pool.query(`
        SELECT 
          COUNT(DISTINCT b.id) as total_bookings,
          COUNT(DISTINCT CASE WHEN b.status = 1 THEN b.id END) as active_bookings,
          COUNT(DISTINCT ce.id) as total_events,
          COUNT(DISTINCT CASE WHEN ce.event_date >= CURDATE() THEN ce.id END) as upcoming_events,
          AVG(b.total_amount) as average_booking_value
        FROM courses c
        LEFT JOIN bookings b ON c.id = b.course_id
        LEFT JOIN course_events ce ON c.id = ce.course_id
        WHERE c.id = ?
      `, [id]);

      // Get recent bookings count by month
      const [monthlyBookings] = await this.pool.query(`
        SELECT 
          DATE_FORMAT(b.created, '%Y-%m') as month,
          COUNT(*) as bookings_count
        FROM bookings b
        WHERE b.course_id = ?
          AND b.created >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
        GROUP BY DATE_FORMAT(b.created, '%Y-%m')
        ORDER BY month DESC
      `, [id]);

      res.json({
        success: true,
        data: {
          overall_stats: stats[0],
          monthly_bookings: monthlyBookings
        }
      });

    } catch (error) {
      console.error('Error fetching course statistics:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch course statistics',
        error: error.message
      });
    }
  }

  /**
   * Get featured/popular courses
   */
  async getFeaturedCourses(req, res) {
    try {
      const [courses] = await this.pool.query(`
        SELECT 
          c.id,
          c.course_name,
          c.course_abb,
          SUBSTRING(c.description, 1, 300) as description_preview,
          c.dsa_fees,
          c.is_cbt,
          COUNT(DISTINCT b.id) as booking_count,
          COUNT(DISTINCT ce.id) as available_events
        FROM courses c
        LEFT JOIN bookings b ON c.id = b.course_id AND b.created >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
        LEFT JOIN course_events ce ON c.id = ce.course_id AND ce.status = 1
        LEFT JOIN course_event_dates ced ON ce.id = ced.course_event_id AND ced.event_date >= CURDATE()
        WHERE c.status = '1'
        GROUP BY c.id, c.course_name, c.course_abb, c.description, c.dsa_fees, c.is_cbt
        ORDER BY 
          CASE WHEN c.course_name = 'CBT' THEN 0 ELSE 1 END,
          booking_count DESC,
          available_events DESC
        LIMIT 6
      `);

      res.json({
        success: true,
        data: courses
      });

    } catch (error) {
      console.error('Error fetching featured courses:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch featured courses',
        error: error.message
      });
    }
  }

  /**
   * Search courses with advanced filtering
   */
  async searchCourses(req, res) {
    try {
      const {
        q = '', // search query
        location_id,
        price_min,
        price_max,
        is_cbt,
        has_events = true,
        limit = 20,
        offset = 0
      } = req.query;

      let query = `
        SELECT DISTINCT
          c.id,
          c.course_name,
          c.course_abb,
          SUBSTRING(c.description, 1, 400) as description_preview,
          c.dsa_fees,
          c.default_booking_limit,
          c.is_cbt,
          c.status,
          COUNT(DISTINCT ce.id) as available_events,
          MIN(ced.event_date) as next_event_date
        FROM courses c
      `;

      const params = [];
      const conditions = ['c.status = ?'];
      params.push('1');

      if (has_events === 'true') {
        query += `
          INNER JOIN course_events ce ON c.id = ce.course_id AND ce.status = 1
          INNER JOIN course_event_dates ced ON ce.id = ced.course_event_id 
          AND ced.event_date >= CURDATE()
        `;
      } else {
        query += `
          LEFT JOIN course_events ce ON c.id = ce.course_id AND ce.status = 1
          LEFT JOIN course_event_dates ced ON ce.id = ced.course_event_id 
          AND ced.event_date >= CURDATE()
        `;
      }

      // Add search conditions
      if (q) {
        conditions.push(`(c.course_name LIKE ? OR c.course_abb LIKE ? OR c.description LIKE ?)`);
        const searchTerm = `%${q}%`;
        params.push(searchTerm, searchTerm, searchTerm);
      }

        if (location_id) {
        conditions.push(`ce.location_id = ?`);
        params.push(location_id);
      }      if (price_min !== undefined) {
        conditions.push(`c.dsa_fees >= ?`);
        params.push(parseFloat(price_min));
      }

      if (price_max !== undefined) {
        conditions.push(`c.dsa_fees <= ?`);
        params.push(parseFloat(price_max));
      }

      if (is_cbt !== undefined) {
        conditions.push(`c.is_cbt = ?`);
        params.push(is_cbt === 'true' ? 1 : 0);
      }

      query += ` WHERE ${conditions.join(' AND ')}`;
      query += ` GROUP BY c.id, c.course_name, c.course_abb, c.description, c.dsa_fees, c.default_booking_limit, c.is_cbt, c.status`;
      query += ` ORDER BY 
        CASE WHEN c.course_name = 'CBT' THEN 0 ELSE 1 END,
        available_events DESC,
        next_event_date ASC,
        c.course_name ASC
      `;
      query += ` LIMIT ? OFFSET ?`;
      params.push(parseInt(limit), parseInt(offset));

      const [courses] = await this.pool.query(query, params);

      res.json({
        success: true,
        data: {
          courses,
          search_params: {
            query: q,
            location_id,
            price_range: { min: price_min, max: price_max },
            is_cbt,
            has_events
          }
        }
      });

    } catch (error) {
      console.error('Error searching courses:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to search courses',
        error: error.message
      });
    }
  }
}

module.exports = CourseController;