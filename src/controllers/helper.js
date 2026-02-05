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

  async getFooterData(req, res) {
    try {
      // Get footer blocks
      const [footerBlocks] = await this.pool.query(`
        SELECT page_content, footer_left_content
        FROM pages
        WHERE id = 73
      `);

      // Get footer menu sections - try all records first
      const [allFooterMenuSections] = await this.pool.query(`
        SELECT id, footer_menu_column, menu_weight, menu_status
        FROM footer_menu_section
        ORDER BY menu_weight ASC
      `);

      const [footerMenuSections] = await this.pool.query(`
        SELECT id, footer_menu_column, menu_weight
        FROM footer_menu_section
        ORDER BY menu_weight ASC
      `);

      // Get all footer links
      const [footerLinks] = await this.pool.query(`
        SELECT footer_link_title, navigation_type, footer_link_url, menu_column, weight
        FROM footer_links
        ORDER BY weight ASC
      `);

      // Get page slugs for navigation links
      const pageIds = footerLinks.map(link => link.navigation_type).filter(id => id);
      let pageMenus = [];
      if (pageIds.length > 0) {
        const [results] = await this.pool.query(`
          SELECT page_link_id, page_slug
          FROM page_menus
          WHERE page_link_id IN (${pageIds.map(() => '?').join(',')})
        `, pageIds);
        pageMenus = results;
      }

      // Create page slug lookup
      const pageSlugMap = {};
      pageMenus.forEach(page => {
        pageSlugMap[page.page_link_id] = page.page_slug;
      });

      // Build menu structure - use fallback if no sections found
      let menu = [];
      if (footerMenuSections.length > 0) {
        menu = footerMenuSections.map(section => {
          const items = footerLinks.filter(link => link.menu_column === section.id);
          return {
            name: section.footer_menu_column,
            items: items.map(link => ({
              footer_link_title: link.footer_link_title,
              navigation_type: link.navigation_type,
              footer_link_url: link.footer_link_url || pageSlugMap[link.navigation_type] || '',
              weight: link.weight
            }))
          };
        });
      } else {
        // Fallback: group by menu_column values
        const columnGroups = {};
        footerLinks.forEach(link => {
          if (!columnGroups[link.menu_column]) {
            columnGroups[link.menu_column] = [];
          }
          columnGroups[link.menu_column].push({
            footer_link_title: link.footer_link_title,
            navigation_type: link.navigation_type,
            footer_link_url: link.footer_link_url || pageSlugMap[link.navigation_type] || '',
            weight: link.weight
          });
        });

        menu = Object.keys(columnGroups).map(columnId => ({
          name: `Menu Column ${columnId}`,
          items: columnGroups[columnId]
        }));
      }

      const footerData = {
        lhs_block: footerBlocks[0]?.footer_left_content || '',
        rhs_block: footerBlocks[0]?.page_content || '',
        menu
      };

      // Process only the text blocks, keep menu as-is
      const processedBlocks = await replaceTokensInObject(this.pool, {
        lhs_block: footerData.lhs_block,
        rhs_block: footerData.rhs_block
      });

      const finalData = {
        ...processedBlocks,
        menu: footerData.menu
      };

      res.json({
        success: true,
        data: finalData
      });
    } catch (error) {
      console.error('Error fetching footer data:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch footer data'
      });
    }
  }

  async getCounterData(req, res) {
    try {
      const [counterData] = await this.pool.query(`
        SELECT taining_centers, qualified_instructors, student_tainined, passing_rate
        FROM training_data

      `);
      console.log(counterData);
      if (!counterData.length) {
        return res.status(404).json({
          success: false,
          message: 'Counter data not found'
        });
      }

      const processedData = await replaceTokensInObject(this.pool, counterData[0]);

      res.json({
        success: true,
        data: processedData
      });
    } catch (error) {
      console.error('Error fetching counter data:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch counter data'
      });
    }
  }
}

module.exports = HelperController;