// src/controllers/locations.js
/**
 * Location Controller - handles training location operations
 */

class LocationController {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Get all active locations
   */
  async getLocations(req, res) {
    try {
      const { 
        status = '1',
        show_in_dl_return,
        show_in_vehicle_schedule,
        limit = 50,
        offset = 0
      } = req.query;

      let query = `
        SELECT 
          id,
          location_name,
          loc_abb,
          map_title,
          marker_label,
          address1,
          address2,
          address3,
          address4,
          postcode,
          latitude,
          longitude,
          show_in_dl_return,
          show_in_vehicle_schedule,
          status,
          created
        FROM locations 
        WHERE status = ?
      `;
      
      const params = [status];

      if (show_in_dl_return !== undefined) {
        query += ` AND show_in_dl_return = ?`;
        params.push(show_in_dl_return);
      }

      if (show_in_vehicle_schedule !== undefined) {
        query += ` AND show_in_vehicle_schedule = ?`;
        params.push(show_in_vehicle_schedule);
      }

      query += ` ORDER BY location_name ASC LIMIT ? OFFSET ?`;
      params.push(parseInt(limit), parseInt(offset));

      const [locations] = await this.pool.query(query, params);

      // Get total count
      let countQuery = `SELECT COUNT(*) as total FROM locations WHERE status = ?`;
      const countParams = [status];

      if (show_in_dl_return !== undefined) {
        countQuery += ` AND show_in_dl_return = ?`;
        countParams.push(show_in_dl_return);
      }

      if (show_in_vehicle_schedule !== undefined) {
        countQuery += ` AND show_in_vehicle_schedule = ?`;
        countParams.push(show_in_vehicle_schedule);
      }

      const [countResult] = await this.pool.query(countQuery, countParams);
      const total = countResult[0].total;

      res.json({
        success: true,
        data: {
          locations,
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
      console.error('Error fetching locations:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch locations',
        error: error.message
      });
    }
  }

  /**
   * Get location by ID with full details
   */
  async getLocationById(req, res) {
    try {
      const { id } = req.params;

      const [locations] = await this.pool.query(`
        SELECT 
          id,
          location_name,
          loc_abb,
          map_title,
          marker_label,
          address1,
          address2,
          address3,
          address4,
          postcode,
          latitude,
          longitude,
          direction_content,
          direction_map,
          show_in_dl_return,
          show_in_vehicle_schedule,
          status,
          created
        FROM locations 
        WHERE id = ? AND status = '1'
      `, [id]);

      if (locations.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Location not found or inactive'
        });
      }

      const location = locations[0];

      // Get upcoming events at this location
      const [upcomingEvents] = await this.pool.query(`
        SELECT 
          ce.id as event_id,
          ce.course_id,
          ce.event_date,
          ce.start_time,
          ce.end_time,
          ce.booking_limit,
          ce.spaces_available,
          c.course_name,
          c.course_abb,
          c.dsa_fees
        FROM course_events ce
        INNER JOIN courses c ON ce.course_id = c.id
        WHERE ce.location_id = ? 
          AND ce.status = 1 
          AND ce.event_date >= CURDATE()
        ORDER BY ce.event_date ASC, ce.start_time ASC
        LIMIT 10
      `, [id]);

      // Get location statistics
      const [stats] = await this.pool.query(`
        SELECT 
          COUNT(DISTINCT ce.id) as total_events,
          COUNT(DISTINCT CASE WHEN ce.event_date >= CURDATE() THEN ce.id END) as upcoming_events,
          COUNT(DISTINCT c.id) as available_courses,
          COUNT(DISTINCT b.id) as total_bookings
        FROM locations l
        LEFT JOIN course_events ce ON l.id = ce.location_id
        LEFT JOIN courses c ON ce.course_id = c.id AND c.status = '1'
        LEFT JOIN bookings b ON ce.id = b.course_event_id
        WHERE l.id = ?
      `, [id]);

      res.json({
        success: true,
        data: {
          location,
          upcoming_events: upcomingEvents,
          statistics: stats[0]
        }
      });

    } catch (error) {
      console.error('Error fetching location:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch location details',
        error: error.message
      });
    }
  }

  /**
   * Get locations with available courses
   */
  async getLocationsWithCourses(req, res) {
    try {
      const { course_id, date_from, date_to } = req.query;

      let query = `
        SELECT DISTINCT
          l.id,
          l.location_name,
          l.loc_abb,
          l.address1,
          l.address2,
          l.postcode,
          l.latitude,
          l.longitude,
          COUNT(DISTINCT ce.id) as available_events,
          COUNT(DISTINCT c.id) as available_courses,
          MIN(ced.event_date) as next_event_date
        FROM locations l
        INNER JOIN course_events ce ON l.id = ce.location_id AND ce.status = 1
        INNER JOIN course_event_dates ced ON ce.id = ced.course_event_id 
          AND ced.event_date >= CURDATE()
        INNER JOIN courses c ON ce.course_id = c.id AND c.status = '1'
        WHERE l.status = '1'
      `;

      const params = [];

      if (course_id) {
        query += ` AND c.id = ?`;
        params.push(course_id);
      }

      if (date_from) {
        query += ` AND ced.event_date >= ?`;
        params.push(date_from);
      }

      if (date_to) {
        query += ` AND ced.event_date <= ?`;
        params.push(date_to);
      }

      query += `
        GROUP BY l.id, l.location_name, l.loc_abb, l.address1, l.address2, 
                 l.postcode, l.latitude, l.longitude
        ORDER BY available_events DESC, next_event_date ASC, l.location_name ASC
      `;

      const [locations] = await this.pool.query(query, params);

      res.json({
        success: true,
        data: locations,
        filters: {
          course_id,
          date_from,
          date_to
        }
      });

    } catch (error) {
      console.error('Error fetching locations with courses:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch locations with available courses',
        error: error.message
      });
    }
  }

  /**
   * Find nearest locations based on postcode/coordinates
   */
  async findNearestLocations(req, res) {
    try {
      const { 
        latitude, 
        longitude, 
        postcode,
        radius = 50, // miles
        limit = 10 
      } = req.query;

      if (!latitude && !longitude && !postcode) {
        return res.status(400).json({
          success: false,
          message: 'Either coordinates (latitude/longitude) or postcode is required'
        });
      }

      // For now, we'll use a simple distance calculation
      // In production, you might want to use a proper geocoding service
      let query = `
        SELECT 
          id,
          location_name,
          loc_abb,
          address1,
          address2,
          postcode,
          latitude,
          longitude,
          ROUND(
            3959 * ACOS(
              COS(RADIANS(?)) * COS(RADIANS(latitude)) * 
              COS(RADIANS(longitude) - RADIANS(?)) + 
              SIN(RADIANS(?)) * SIN(RADIANS(latitude))
            ), 2
          ) AS distance_miles
        FROM locations
        WHERE status = '1' 
          AND latitude IS NOT NULL 
          AND longitude IS NOT NULL
      `;

      const params = [];
      
      if (latitude && longitude) {
        params.push(parseFloat(latitude), parseFloat(longitude), parseFloat(latitude));
      } else {
        // If only postcode provided, you'd need a geocoding service here
        // For now, return all locations
        params.push(51.5074, -0.1278, 51.5074); // London coordinates as fallback
      }

      query += ` HAVING distance_miles <= ? ORDER BY distance_miles ASC LIMIT ?`;
      params.push(parseFloat(radius), parseInt(limit));

      const [locations] = await this.pool.query(query, params);

      res.json({
        success: true,
        data: locations,
        search_center: {
          latitude: parseFloat(latitude) || 51.5074,
          longitude: parseFloat(longitude) || -0.1278,
          postcode,
          radius: parseFloat(radius)
        }
      });

    } catch (error) {
      console.error('Error finding nearest locations:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to find nearest locations',
        error: error.message
      });
    }
  }

  /**
   * Get location statistics
   */
  async getLocationStats(req, res) {
    try {
      const [overallStats] = await this.pool.query(`
        SELECT 
          COUNT(*) as total_locations,
          COUNT(CASE WHEN status = '1' THEN 1 END) as active_locations,
          COUNT(CASE WHEN show_in_dl_return = 1 THEN 1 END) as dl_return_locations,
          COUNT(CASE WHEN show_in_vehicle_schedule = 1 THEN 1 END) as vehicle_schedule_locations
        FROM locations
      `);

      const [locationActivity] = await this.pool.query(`
        SELECT 
          l.id,
          l.location_name,
          COUNT(DISTINCT ce.id) as total_events,
          COUNT(DISTINCT CASE WHEN ce.event_date >= CURDATE() THEN ce.id END) as upcoming_events,
          COUNT(DISTINCT b.id) as total_bookings
        FROM locations l
        LEFT JOIN course_events ce ON l.id = ce.location_id
        LEFT JOIN bookings b ON ce.id = b.course_event_id
        WHERE l.status = '1'
        GROUP BY l.id, l.location_name
        ORDER BY total_bookings DESC, upcoming_events DESC
        LIMIT 10
      `);

      res.json({
        success: true,
        data: {
          overall: overallStats[0],
          activity_by_location: locationActivity
        }
      });

    } catch (error) {
      console.error('Error fetching location statistics:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch location statistics',
        error: error.message
      });
    }
  }
}

module.exports = LocationController;