// src/controllers/allLocations.js
/**
 * All Locations Controller - handles all locations content from existing tables
 */

const dotenv = require('dotenv');
dotenv.config();

class AllLocationsController {
  constructor(pool) {
    this.pool = pool;

    // Initialize SMTP transporter once per controller instance
    try {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587,
        secure: (process.env.SMTP_SECURE === 'true'), // true for 465, false for other ports
        auth: process.env.SMTP_USER && process.env.SMTP_PASS ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        } : undefined
      });
    } catch (err) {
      console.error('Failed to create SMTP transporter:', err);
      this.transporter = null;
    }
  }

  async getalllocation(req, res) {
    try {
        const locationData = {
            locationName: '',
            locationPicture: '',
            address: [],
            coordinates: { lat: '', lng: '' },
            course_names: [],
        };
        const [content] = await this.pool.query(`
          SELECT
            l.id AS location_id,
            l.location_name,
            l.address1,
            l.address2,
            l.address3,
            l.address4,
            l.postcode,
            l.latitude,
            l.longitude,
            l.direction_map,
            GROUP_CONCAT(c.course_name) AS course_names
          FROM locations l
          LEFT JOIN location_course_pages lcp ON lcp.location_id = l.id
          LEFT JOIN courses c ON c.id = lcp.course_id
          GROUP BY l.id, l.location_name, l.address1, l.address2, l.address3, l.address4, l.postcode, l.latitude, l.longitude, l.direction_map
        `);

        const locations = content.map(location => ({
          locationName: location.location_name || '',
          locationPicture: location.direction_map || '',
          address: [
            location.address1 || '',
            location.address2 || '',
            location.address3 || '',
            location.address4 || '',
            location.postcode || ''
          ],
          coordinates: {
            lat: location.latitude || '',
            lng: location.longitude || ''
          },
          course_names: location.course_names ? location.course_names.split(',') : []
        }));
        res.json({
            locationData: locations
        });
    } catch (err) {
      console.error('Error fetching all locations content:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
}
}

module.exports = AllLocationsController;