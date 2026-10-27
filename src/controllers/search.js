// src/controllers/search.js
class SearchController {
  constructor(pool) {
    this.pool = pool;
  }

  async getSuggestions(req, res) {
    try {
      const { q } = req.query;
      
      if (!q || q.length < 2) {
        return res.json({ success: true, data: [] });
      }

      const searchTerm = `%${q}%`;
      const limit = 10;

      // Search across multiple tables
      const [results] = await this.pool.query(`
        (SELECT 'course' as type, id, page_title as title, slug, NULL as location FROM pages WHERE page_title LIKE ? LIMIT 3)
        UNION ALL
        (SELECT 'location' as type, id, location_name as title, loc_abb as slug, location_name as location FROM locations WHERE location_name LIKE ? AND status = 1 LIMIT 3)
        UNION ALL
        (SELECT 'page' as type, id, page_title as title, slug, NULL as location FROM pages WHERE page_content LIKE ? LIMIT 4)
        LIMIT ?
      `, [searchTerm, searchTerm, searchTerm, limit]);

      const suggestions = results.map(item => ({
        type: item.type,
        id: item.id,
        title: item.title,
        url: item.type === 'location' ? `/location/${item.slug}` : `/${item.slug}`,
        location: item.location
      }));

      res.json({ success: true, data: suggestions });
    } catch (error) {
      console.error('Error fetching search suggestions:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  async search(req, res) {
    try {
      const { q, type = 'all', page = 1, limit = 20 } = req.query;

      if (!q || q.length < 2) {
        return res.json({ success: true, data: { results: [], total: 0, page: 1, totalPages: 0 } });
      }

      const searchTerm = `%${q}%`;
      const offset = (page - 1) * limit;

      let query = '';
      let countQuery = '';
      let params = [];
      let countParams = [];

      if (type === 'all' || type === 'courses') {
        query += `
          (SELECT 'course' as type, p.id, p.page_title as title, p.slug, p.meta_desc as description, 
                  p.carousel_static_image as image, NULL as location, p.created as created_at
           FROM pages p
           WHERE (p.page_title LIKE ? OR p.page_content LIKE ? OR p.meta_desc LIKE ?))
        `;
        params.push(searchTerm, searchTerm, searchTerm);
        
        countQuery += `SELECT COUNT(*) as count FROM pages WHERE (page_title LIKE ? OR page_content LIKE ?)`;
        countParams.push(searchTerm, searchTerm);
      }

      if (type === 'all' || type === 'locations') {
        if (query) query += ' UNION ALL ';
        query += `
          (SELECT 'location' as type, l.id, l.location_name as title, l.loc_abb as slug, l.address1 as description,
                  NULL as image, l.location_name as location, l.created as created_at
           FROM locations l
           WHERE (l.location_name LIKE ? OR l.address1 LIKE ?) 
           AND l.status = 1)
        `;
        params.push(searchTerm, searchTerm);

        if (countQuery) countQuery += ' UNION ALL ';
        countQuery += `SELECT COUNT(*) as count FROM locations WHERE (location_name LIKE ? OR address1 LIKE ?) AND status = 1`;
        countParams.push(searchTerm, searchTerm);
      }

      if (type === 'all' || type === 'pages') {
        if (query) query += ' UNION ALL ';
        query += `
          (SELECT 'page' as type, p.id, p.page_title as title, p.slug, p.meta_desc as description,
                  p.carousel_static_image as image, NULL as location, p.created as created_at
           FROM pages p
           WHERE (p.page_title LIKE ? OR p.page_content LIKE ?))
        `;
        params.push(searchTerm, searchTerm);

        if (countQuery) countQuery += ' UNION ALL ';
        countQuery += `SELECT COUNT(*) as count FROM pages WHERE (page_title LIKE ? OR page_content LIKE ?)`;
        countParams.push(searchTerm, searchTerm);
      }

      query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      params.push(parseInt(limit), parseInt(offset));

      const [results] = await this.pool.query(query, params);
      const [countResults] = await this.pool.query(`SELECT SUM(count) as total FROM (${countQuery}) as counts`, countParams);

      const total = countResults[0]?.total || 0;
      const totalPages = Math.ceil(total / limit);

      const formattedResults = results.map(item => ({
        type: item.type,
        id: item.id,
        title: item.title,
        description: item.description,
        image: item.image ? `/uploads/${item.type}s/${item.image}` : null,
        url: item.type === 'location' ? `/location/${item.slug}` : `/${item.slug}`,
        location: item.location
      }));

      res.json({
        success: true,
        data: {
          results: formattedResults,
          total,
          page: parseInt(page),
          totalPages,
          limit: parseInt(limit)
        }
      });
    } catch (error) {
      console.error('Error performing search:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
}

module.exports = SearchController;
