// src/controllers/dynamicData.js
/**
 * Dynamic Data Controller - handles dynamic table data fetching
 */

class DynamicDataController {
  constructor(pool) {
    this.pool = pool;

    // Define allowed tables for security
    this.allowedTables = [
      'accreditations',
      'featured_services',
      'testimonials',
      'faqs',
      'faq_categories',
      'courses',
      'locations',
      'pages',
      'carousels'
    ];
  }

  /**
   * Get data from multiple tables dynamically
   */
  async getData(req, res) {
    try {
      const { tables } = req.body;

      if (!tables || !Array.isArray(tables)) {
        return res.status(400).json({
          success: false,
          message: 'Tables parameter must be an array'
        });
      }

      // Validate table names for security
      const invalidTables = tables.filter(table => !this.allowedTables.includes(table));
      if (invalidTables.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid table names: ${invalidTables.join(', ')}`
        });
      }

      const result = {};

      // Fetch data from each requested table
      for (const tableName of tables) {
        try {
          const [data] = await this.pool.query(`SELECT * FROM ${tableName}`);
          result[tableName] = data;
        } catch (error) {
          console.error(`Error fetching data from ${tableName}:`, error);
          result[tableName] = [];
        }
      }

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      console.error('Error fetching dynamic data:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch data',
        error: error.message
      });
    }
  }
}

module.exports = DynamicDataController;