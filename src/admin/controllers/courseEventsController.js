const {
  listCourseEvents,
  getLocationsByCourse,
  getCourseEventDetail,
  getCourseEventBookingCount,
  deleteCourseEvent,
  bulkDeleteCourseEvents,
} = require('../services/courseEventsService');
const {
  getWizardState,
  setWizardState,
  clearWizardState,
  mergeWizardState,
  buildCalendarMonth,
  getWizardFormOptions,
  prepareEditWizard,
  prepareBulkEditWizard,
  getBulkEditDates,
  isEventFrozen,
  saveWizard,
} = require('../services/courseEventWizardService');
const {
  getDayFreezePreview,
  bulkDayFreeze,
} = require('../services/dayFreezeService');

class CourseEventsController {
  constructor(pool) {
    this.pool = pool;
  }

  getAdminId(req) {
    const admin =
      req.session?.loggedinAdmin?.id ||
      req.session?.loggedinAdmin?.admin_id ||
      req.session?.admin ||
      0;
    return Number(admin) || 0;
  }

  async list(req, res) {
    try {
      const data = await listCourseEvents(this.pool, {
        page: req.query.page,
        searchterm: {
          name_scr: req.query.name_scr,
          from_scr: req.query.from_scr,
          to_scr: req.query.to_scr,
          loc_scr: req.query.loc_scr,
          sort: req.query.sort,
        },
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][COURSE_EVENTS][LIST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load course events',
      });
    }
  }

  async locationsByCourse(req, res) {
    try {
      const courseId = req.query.cid || req.query.course_id;
      const locationOptions = await getLocationsByCourse(this.pool, courseId);
      return res.json({ success: true, data: { locationOptions } });
    } catch (err) {
      console.error('[ADMIN][COURSE_EVENTS][LOCATIONS]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load locations',
      });
    }
  }

  async getOne(req, res) {
    try {
      const id = Number(req.params.id);
      const detail = await getCourseEventDetail(this.pool, id);
      if (!detail) {
        return res.status(404).json({
          success: false,
          message: 'Event not found to view',
        });
      }
      return res.json({ success: true, data: detail });
    } catch (err) {
      console.error('[ADMIN][COURSE_EVENTS][GET]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load course event',
      });
    }
  }

  async bookingCount(req, res) {
    try {
      const id = Number(req.params.id);
      const count = await getCourseEventBookingCount(this.pool, id);
      return res.json({ success: true, data: { count } });
    } catch (err) {
      console.error('[ADMIN][COURSE_EVENTS][BOOKING_COUNT]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to check bookings',
      });
    }
  }

  async remove(req, res) {
    try {
      const id = Number(req.params.id);
      const result = await deleteCourseEvent(
        this.pool,
        id,
        this.getAdminId(req)
      );
      return res.json({ success: true, message: result.message, data: result });
    } catch (err) {
      if (err.status === 409 && err.message === 'processing') {
        return res.status(409).json({
          success: false,
          message:
            'This course event has bookings currently in progress and cannot be deleted.',
        });
      }
      console.error('[ADMIN][COURSE_EVENTS][DELETE]', err.message);
      return res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Error in deleting course',
      });
    }
  }

  async bulkRemove(req, res) {
    try {
      const items = req.body?.data || req.body?.items || [];
      const result = await bulkDeleteCourseEvents(
        this.pool,
        items,
        this.getAdminId(req)
      );
      return res.json({
        success: true,
        message: result.message,
      });
    } catch (err) {
      console.error('[ADMIN][COURSE_EVENTS][BULK_DELETE]', err.message);
      return res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Error in deleting courses',
      });
    }
  }

  async getWizard(req, res) {
    try {
      const state = getWizardState(req.session);
      const bulkDates = state.isBulkEdit
        ? await getBulkEditDates(
            this.pool,
            state.bulkEventIds?.length
              ? state.bulkEventIds
              : req.session?.eventIds || []
          )
        : [];
      const isFrozen = state.id
        ? await isEventFrozen(this.pool, state.id)
        : false;
      return res.json({
        success: true,
        data: { state, bulkDates, isFrozen },
      });
    } catch (err) {
      console.error('[ADMIN][COURSE_EVENTS][WIZARD_GET]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load wizard state',
      });
    }
  }

  async updateWizard(req, res) {
    try {
      const state = mergeWizardState(req.session, req.body || {});
      return res.json({ success: true, data: { state } });
    } catch (err) {
      console.error('[ADMIN][COURSE_EVENTS][WIZARD_PUT]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to update wizard state',
      });
    }
  }

  async resetWizard(req, res) {
    try {
      const editId = Number(req.body?.editId);
      if (editId) {
        const state = await prepareEditWizard(req.session, this.pool, editId);
        return res.json({ success: true, data: { state } });
      }
      clearWizardState(req.session);
      return res.json({ success: true, data: { state: getWizardState(req.session) } });
    } catch (err) {
      console.error('[ADMIN][COURSE_EVENTS][WIZARD_RESET]', err.message);
      return res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Unable to reset wizard',
      });
    }
  }

  async prepareEdit(req, res) {
    try {
      const editId = Number(req.body?.editId);
      const state = await prepareEditWizard(req.session, this.pool, editId);
      return res.json({ success: true, data: { state } });
    } catch (err) {
      console.error('[ADMIN][COURSE_EVENTS][WIZARD_PREPARE_EDIT]', err.message);
      return res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Event not found to edit',
      });
    }
  }

  async prepareBulkEdit(req, res) {
    try {
      const eventIds = req.body?.eventIds || [];
      const editId = Number(req.body?.editId);
      const { state, bulkDates } = await prepareBulkEditWizard(
        req.session,
        this.pool,
        { primaryEventId: editId, eventIds }
      );
      return res.json({ success: true, data: { state, bulkDates } });
    } catch (err) {
      console.error('[ADMIN][COURSE_EVENTS][WIZARD_PREPARE_BULK]', err.message);
      return res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Unable to prepare bulk edit',
      });
    }
  }

  async wizardFormOptions(req, res) {
    try {
      const data = await getWizardFormOptions(this.pool);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][COURSE_EVENTS][WIZARD_OPTIONS]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load form options',
      });
    }
  }

  async wizardCalendar(req, res) {
    try {
      const data = buildCalendarMonth(req.query.month, req.query.year);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][COURSE_EVENTS][WIZARD_CALENDAR]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load calendar',
      });
    }
  }

  async saveWizard(req, res) {
    try {
      const result = await saveWizard(this.pool, req.session, req.body || {});
      return res.json({ success: true, message: result.message, data: result });
    } catch (err) {
      console.error('[ADMIN][COURSE_EVENTS][WIZARD_SAVE]', err.message);
      return res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Error in saving course event',
      });
    }
  }

  async getDayFreezePreview(req, res) {
    try {
      const day = req.query.day;
      const data = await getDayFreezePreview(this.pool, day);
      return res.json({ success: true, data });
    } catch (err) {
      const status = err.status || 500;
      console.error('[ADMIN][COURSE_EVENTS][DAY_FREEZE_PREVIEW]', err.message);
      return res.status(status).json({
        success: false,
        message: err.message || 'Unable to load day freeze preview',
      });
    }
  }

  async applyDayFreeze(req, res) {
    try {
      const day = req.body?.day ?? req.query?.day;
      const fstatus = req.body?.fstatus ?? req.query?.fstatus;
      const data = await bulkDayFreeze(this.pool, day, fstatus);
      return res.json({ success: true, data, message: data.message });
    } catch (err) {
      const status = err.status || 500;
      console.error('[ADMIN][COURSE_EVENTS][DAY_FREEZE]', err.message);
      return res.status(status).json({
        success: false,
        message: err.message || 'Unable to update day freeze',
      });
    }
  }
}

module.exports = CourseEventsController;
