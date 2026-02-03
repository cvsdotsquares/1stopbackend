// src/controllers/helper.js
const { replaceTokensInObject } = require('../utils/tokenReplacer');

class HelperController {
  constructor(pool) {
    this.pool = pool;
  }

  async suggestPostalCodes(req, res) {
    try {
      const { query } = req.body;

      if (!query || query.length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Query must be at least 2 characters long'
        });
      }

      const [locations] = await this.pool.query(`
        SELECT DISTINCT l.postcode
        FROM locations l
        INNER JOIN location_course_pages lcp ON lcp.location_id = l.id AND lcp.is_active = 1
        LEFT JOIN courses c ON c.id = lcp.course_id
        WHERE l.postcode LIKE ? AND l.postcode IS NOT NULL AND l.postcode != ''
        ORDER BY l.postcode ASC
        LIMIT 10
      `, [`%${query}%`]);

      const suggestions = locations.map(row => row.postcode);

      res.json({
        success: true,
        data: suggestions
      });
    } catch (error) {
      console.error('Error fetching postal code suggestions:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch postal code suggestions'
      });
    }
  }

  async getMenuStructure(req, res) {
    try {
      const { id } = req.body;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: 'Menu group ID is required'
        });
      }

      // Get group_name from menu_groups table
      const [menuGroup] = await this.pool.query(`
        SELECT group_name FROM menu_groups WHERE id = ?
      `, [id]);

      if (!menuGroup.length) {
        return res.status(404).json({
          success: false,
          message: 'Menu group not found'
        });
      }

      const groupName = menuGroup[0].group_name;

      // Get all menu items for this group
      const [menuItems] = await this.pool.query(`
        SELECT id, page_title, page_slug, parent_id, page_link_id, sort_order
        FROM page_menus
        WHERE menu_group = ?
        ORDER BY id ASC
      `, [groupName]);

      // Build nested structure
      const buildMenuTree = (items, parentId = null) => {
        return items
          .filter(item => (item.parent_id === parentId || (parentId === null && (item.parent_id === null || item.parent_id === 0))))
          .map(item => ({
            id: item.id,
            page_title: item.page_title,
            page_slug: item.page_slug,
            page_link_id: item.page_link_id,
            sort_order: item.sort_order,
            children: buildMenuTree(items, item.id)
          }));
      };

      const menuStructure = buildMenuTree(menuItems);
      const processedData = await replaceTokensInObject(this.pool, {
        group_name: groupName,
        menu_items: menuStructure
      });

      res.json({
        success: true,
        data: processedData
      });
    } catch (error) {
      console.error('Error fetching menu structure:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch menu structure'
      });
    }
  }

  async processContent(req, res) {
    try {
      const { content } = req.body;

      if (!content) {
        return res.status(400).json({
          success: false,
          message: 'Content is required'
        });
      }

      const processedContent = await replaceTokensInObject(this.pool, { content });

      res.json({
        success: true,
        data: processedContent
      });
    } catch (error) {
      console.error('Error processing content:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to process content'
      });
    }
  }
}

module.exports = HelperController;