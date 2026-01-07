class SearchController {
    constructor(pool) {
        this.pool = pool;
        this.search = this.search.bind(this);
    }

    async search(req, res) {
        try {
            const { q } = req.query;

            if (!q || q.trim().length < 2) {
                return res.status(400).json({
                    success: false,
                    message: 'Search term must be at least 2 characters'
                });
            }

            const searchTerm = `%${q}%`;

            const [rows] = await this.pool.execute(
                `SELECT slug, link_title
                 FROM pages
                 WHERE page_content LIKE ?`,
                [searchTerm]
            );

            return res.json({
                success: true,
                count: rows.length,
                data: rows
            });

        } catch (error) {
            console.error('Search Error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    }
}

module.exports = SearchController;
