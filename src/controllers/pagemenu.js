class PageMenuController {
    constructor(pool) {
        this.pool = pool;
    }

    getPageMenus = async (req, res) => {
        try {
            const query = `
                SELECT pm.*, p.page_title as parent_page 
                FROM page_menus pm 
                LEFT JOIN pages p ON pm.parent_id = p.id 
                ORDER BY pm.id DESC
            `;
            
            const data = await this.pool.query(query);
            
            res.json({
                success: true,
                data: data[0]
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    };
}

module.exports = PageMenuController;
