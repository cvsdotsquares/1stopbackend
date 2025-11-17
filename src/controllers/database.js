// src/controllers/database.js
class DatabaseController {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Get database table list
   */
  async getTables(req, res) {
    try {
      const [tables] = await this.pool.query(`
        SHOW TABLES
      `);
      
      res.json({
        success: true,
        data: tables
      });
    } catch (error) {
      console.error('Error fetching tables:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch tables',
        error: error.message
      });
    }
  }

  /**
   * Get table structure
   */
  async getTableStructure(req, res) {
    try {
      const { tableName } = req.params;
      
      // Validate table name to prevent SQL injection
      if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid table name'
        });
      }

      const [structure] = await this.pool.query(`
        DESCRIBE ${tableName}
      `);
      
      const [sample] = await this.pool.query(`
        SELECT * FROM ${tableName} LIMIT 3
      `);
      
      res.json({
        success: true,
        data: {
          table: tableName,
          structure: structure,
          sample: sample
        }
      });
    } catch (error) {
      console.error('Error fetching table structure:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch table structure',
        error: error.message
      });
    }
  }

  /**
   * Search for CMS-related content
   */
  async searchCMSContent(req, res) {
    try {
      // Look for tables that might contain CMS content
      const cmsQueries = [
        // Check for posts/articles table
        `SELECT 'posts' as table_name, COUNT(*) as count FROM posts WHERE 1`,
        `SELECT 'articles' as table_name, COUNT(*) as count FROM articles WHERE 1`,
        `SELECT 'pages' as table_name, COUNT(*) as count FROM pages WHERE 1`,
        `SELECT 'content' as table_name, COUNT(*) as count FROM content WHERE 1`,
        `SELECT 'news' as table_name, COUNT(*) as count FROM news WHERE 1`,
        `SELECT 'blog' as table_name, COUNT(*) as count FROM blog WHERE 1`,
        `SELECT 'cms_pages' as table_name, COUNT(*) as count FROM cms_pages WHERE 1`,
        `SELECT 'site_content' as table_name, COUNT(*) as count FROM site_content WHERE 1`
      ];

      const results = [];
      
      for (const query of cmsQueries) {
        try {
          const [result] = await this.pool.query(query);
          if (result && result.length > 0) {
            results.push(result[0]);
          }
        } catch (error) {
          // Table doesn't exist, continue
          console.log(`Table not found: ${error.message}`);
        }
      }

      res.json({
        success: true,
        data: {
          cms_tables_found: results,
          message: results.length > 0 ? 'CMS tables found' : 'No obvious CMS tables found'
        }
      });

    } catch (error) {
      console.error('Error searching CMS content:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to search CMS content',
        error: error.message
      });
    }
  }
}

module.exports = DatabaseController;