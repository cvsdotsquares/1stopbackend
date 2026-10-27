class LocationCourseController {
    constructor(pool) {
        this.pool = pool;
    }

    getLocationCoursePages = async (req, res) => {
        try {
            const { page = 1, limit = 200, search = '', location_filter = '', course_filter = '' } = req.query;
            const offset = (page - 1) * limit;
            
            let whereClause = "WHERE lcp.is_active = 1 AND lcp.id IS NOT NULL";
            let params = [];
            
            if (search) {
                whereClause += " AND (lcp.page_title LIKE ? OR lcp.content LIKE ? OR l.location_name LIKE ? OR c.course_name LIKE ?)";
                params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
            }
            
            if (location_filter) {
                whereClause += " AND lcp.location_id = ?";
                params.push(location_filter);
            }
            
            if (course_filter) {
                whereClause += " AND lcp.course_id = ?";
                params.push(course_filter);
            }
            
            const query = `
                SELECT lcp.*, l.location_name, c.course_name 
                FROM location_course_pages lcp
                LEFT JOIN locations l ON lcp.location_id = l.id
                LEFT JOIN courses c ON lcp.course_id = c.id
                ${whereClause}
                ORDER BY lcp.id DESC
                LIMIT ? OFFSET ?
            `;
            
            const countQuery = `
                SELECT COUNT(*) as total
                FROM location_course_pages lcp
                LEFT JOIN locations l ON lcp.location_id = l.id
                LEFT JOIN courses c ON lcp.course_id = c.id
                ${whereClause}
            `;
            
            const queryParams = [...params, parseInt(limit), parseInt(offset)];
            const [data, countResult] = await Promise.all([
                this.pool.query(query, queryParams),
                this.pool.query(countQuery, params)
            ]);
            
            res.json({
                success: true,
                data: data[0],
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(countResult[0][0].total),
                    totalPages: Math.ceil(countResult[0][0].total / limit)
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    };
}

module.exports = LocationCourseController;
