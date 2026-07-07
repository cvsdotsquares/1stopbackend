const {
  listCourseEvents,
  getCourseEventView,
  updateCourseEventStatus,
  getBookingCount,
  deleteCourseEvent,
  getCourseFilterOptions,
  getLocationFilterOptions,
} = require('../services/courseEventsService');

class CourseEventsController {
  constructor(pool) {
    this.pool = pool;
  }

  getAdminId(req) {
    const admin = req.session?.loggedinAdmin;
    return admin?.admin_id ?? admin?.id ?? null;
  }

  async list(req, res) {
    try {
      const data = await listCourseEvents(this.pool, {
        page: req.query.page,
        searchterm: {
          from_scr: req.query.from_scr,
          to_scr: req.query.to_scr,
          name_scr: req.query.name_scr,
          loc_scr: req.query.loc_scr,
          sort: req.query.sort,
        },
      });

      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][COURSE-EVENTS][LIST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load course events',
      });
    }
  }

  async courseFilters(req, res) {
    try {
      const courses = await getCourseFilterOptions(this.pool);
      return res.json({ success: true, data: { courses } });
    } catch (err) {
      console.error('[ADMIN][COURSE-EVENTS][COURSE-FILTERS]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load course filters',
      });
    }
  }

  async locationFilters(req, res) {
    try {
      const locations = await getLocationFilterOptions(
        this.pool,
        req.query.courseId
      );
      return res.json({ success: true, data: { locations } });
    } catch (err) {
      console.error('[ADMIN][COURSE-EVENTS][LOCATION-FILTERS]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load location filters',
      });
    }
  }

  async getOne(req, res) {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(404).json({
          success: false,
          message: 'Event not found to view',
        });
      }

      const result = await getCourseEventView(this.pool, id);
      if (!result.ok) {
        return res.status(404).json({
          success: false,
          message: result.message,
        });
      }

      return res.json({
        success: true,
        data: result.data,
      });
    } catch (err) {
      console.error('[ADMIN][COURSE-EVENTS][VIEW]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load course event',
      });
    }
  }

  async updateStatus(req, res) {
    try {
      const id = Number(req.params.id);
      const status = String(req.body?.status ?? '');

      if (!Number.isFinite(id) || id <= 0) {
        return res.status(404).json({
          success: false,
          message: 'Course event not found to delete',
        });
      }

      if (status !== '0' && status !== '1') {
        return res.status(400).json({
          success: false,
          message: 'Invalid status',
        });
      }

      const result = await updateCourseEventStatus(this.pool, id, status);
      if (!result.ok) {
        return res.status(400).json({
          success: false,
          message: result.message,
        });
      }

      return res.json({
        success: true,
        message: result.message,
      });
    } catch (err) {
      console.error('[ADMIN][COURSE-EVENTS][STATUS]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in change status',
      });
    }
  }

  async bookingCount(req, res) {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(404).json({
          success: false,
          message: 'Course event not found',
        });
      }

      const count = await getBookingCount(this.pool, id);
      return res.json({
        success: true,
        data: { bookingCount: count },
      });
    } catch (err) {
      console.error('[ADMIN][COURSE-EVENTS][BOOKING-COUNT]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to check bookings',
      });
    }
  }

  async remove(req, res) {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(404).json({
          success: false,
          message: 'Course event not found',
        });
      }

      const result = await deleteCourseEvent(this.pool, id, this.getAdminId(req));
      if (!result.ok) {
        const status = result.code === 'processing' ? 409 : 400;
        return res.status(status).json({
          success: false,
          message: result.message,
          code: result.code,
        });
      }

      return res.json({
        success: true,
        message: result.message,
        code: result.code,
      });
    } catch (err) {
      console.error('[ADMIN][COURSE-EVENTS][DELETE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in deleteing course',
      });
    }
  }
}

module.exports = CourseEventsController;
