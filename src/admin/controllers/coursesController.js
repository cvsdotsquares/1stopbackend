const {
  listCourses,
  getCourseById,
  createCourse,
  updateCourse,
  updateCourseStatus,
  softDeleteCourse,
} = require('../services/coursesService');

class CoursesController {
  constructor(pool) {
    this.pool = pool;
  }

  async list(req, res) {
    try {
      const data = await listCourses(this.pool, {
        page: req.query.page,
        searchterm: {
          name_scr: req.query.name_scr,
          sort: req.query.sort,
        },
      });

      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][COURSES][LIST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load courses',
      });
    }
  }

  async getOne(req, res) {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(404).json({
          success: false,
          message: 'Course not found to edit',
        });
      }

      const course = await getCourseById(this.pool, id);
      if (!course) {
        return res.status(404).json({
          success: false,
          message: 'Course not found to edit',
        });
      }

      return res.json({ success: true, data: course });
    } catch (err) {
      console.error('[ADMIN][COURSES][GET]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load course',
      });
    }
  }

  async create(req, res) {
    try {
      const result = await createCourse(this.pool, req.body || {});

      if (!result.ok) {
        return res.status(400).json({
          success: false,
          message: result.message,
        });
      }

      return res.status(201).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (err) {
      console.error('[ADMIN][COURSES][CREATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in adding course',
      });
    }
  }

  async update(req, res) {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(404).json({
          success: false,
          message: 'Course not found to edit',
        });
      }

      const result = await updateCourse(this.pool, id, req.body || {});

      if (!result.ok) {
        const status = result.message.includes('not found') ? 404 : 400;
        return res.status(status).json({
          success: false,
          message: result.message,
        });
      }

      return res.json({
        success: true,
        message: result.message,
      });
    } catch (err) {
      console.error('[ADMIN][COURSES][UPDATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in updating course',
      });
    }
  }

  async updateStatus(req, res) {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(404).json({
          success: false,
          message: 'Course not found to delete',
        });
      }

      const result = await updateCourseStatus(
        this.pool,
        id,
        req.body?.status
      );

      if (!result.ok) {
        const status = result.message.includes('not found') ? 404 : 400;
        return res.status(status).json({
          success: false,
          message: result.message,
        });
      }

      return res.json({
        success: true,
        message: result.message,
      });
    } catch (err) {
      console.error('[ADMIN][COURSES][STATUS]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in change status',
      });
    }
  }

  async remove(req, res) {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(404).json({
          success: false,
          message: 'Course not found to delete',
        });
      }

      const result = await softDeleteCourse(this.pool, id);
      if (!result.ok) {
        const status = result.message.includes('not found') ? 404 : 400;
        return res.status(status).json({
          success: false,
          message: result.message,
        });
      }

      return res.json({
        success: true,
        message: result.message,
      });
    } catch (err) {
      console.error('[ADMIN][COURSES][DELETE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in deleting course',
      });
    }
  }
}

module.exports = CoursesController;
