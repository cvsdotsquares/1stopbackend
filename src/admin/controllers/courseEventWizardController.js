const {
  startWizardWithPool,
  getStep1Data,
  saveStep1,
  applySessionPatch,
  getStep2Data,
  saveStep2,
  editLoad,
  buildMultiFragment,
  removeMultiLink,
  isStep1Valid,
  getCourseSelectOptions,
} = require('../services/courseEventWizardService');

class CourseEventWizardController {
  constructor(pool) {
    this.pool = pool;
  }

  async start(req, res) {
    try {
      const editId = req.body?.editId;
      const result = await startWizardWithPool(this.pool, req, { editId });
      if (result.error) {
        return res.status(404).json({
          success: false,
          message: result.error,
          data: { redirectCode: result.code },
        });
      }
      return res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      console.error('[ADMIN][COURSE-EVENT-WIZARD][START]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to start course event wizard',
      });
    }
  }

  async step1Get(req, res) {
    try {
      const data = await getStep1Data(this.pool, req, req.query);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][COURSE-EVENT-WIZARD][STEP1-GET]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load wizard step 1',
      });
    }
  }

  async step1Post(req, res) {
    try {
      const courseEvent = saveStep1(req, req.body);
      return res.json({
        success: true,
        data: { courseEvent, valid: isStep1Valid(req) },
      });
    } catch (err) {
      console.error('[ADMIN][COURSE-EVENT-WIZARD][STEP1-POST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to save wizard step 1',
      });
    }
  }

  async sessionPatch(req, res) {
    try {
      const courseEvent = applySessionPatch(req, req.body);
      return res.json({
        success: true,
        data: { courseEvent, valid: isStep1Valid(req) },
      });
    } catch (err) {
      console.error('[ADMIN][COURSE-EVENT-WIZARD][PATCH]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to update wizard session',
      });
    }
  }

  async step2Get(req, res) {
    try {
      const multipal =
        req.query.multipal === 'true' || req.query.multipal === '1';
      const data = await getStep2Data(this.pool, req, { multipal });
      if (data.error) {
        return res.status(400).json({
          success: false,
          message: data.error,
        });
      }
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][COURSE-EVENT-WIZARD][STEP2-GET]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load wizard step 2',
      });
    }
  }

  async step2Post(req, res) {
    try {
      const multipal =
        req.query.multipal === 'true' ||
        req.query.multipal === '1' ||
        req.body?.multipal === true;
      const result = await saveStep2(this.pool, req, req.body, { multipal });
      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.message,
        });
      }
      return res.json({
        success: true,
        message: result.message,
        data: { redirect: result.redirect },
      });
    } catch (err) {
      console.error('[ADMIN][COURSE-EVENT-WIZARD][STEP2-POST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to save course event',
      });
    }
  }

  async multiFragment(req, res) {
    try {
      if (req.body?.doAction === 'remove' || req.query.doAction === 'remove') {
        const linkNo = req.body?.linkNo ?? req.query.linkNo;
        const courseEvent = removeMultiLink(req, linkNo);
        return res.json({ success: true, data: { courseEvent, removed: true } });
      }

      const linkNo = req.body?.linkNo ?? req.query.linkNo ?? 0;
      const courses = await getCourseSelectOptions(this.pool);
      const fragment = buildMultiFragment(req, linkNo);
      return res.json({
        success: true,
        data: {
          ...fragment,
          courses,
        },
      });
    } catch (err) {
      console.error('[ADMIN][COURSE-EVENT-WIZARD][MULTI-FRAGMENT]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load linked course block',
      });
    }
  }

  async editLoad(req, res) {
    try {
      const editId = req.params.id || req.body?.editId;
      const doAction = req.body?.doAction || 'edit';
      const eventIds = req.body?.eventIds || [];

      const result = await editLoad(this.pool, req, {
        editId,
        doAction,
        eventIds,
      });

      if (!result.success) {
        return res.status(404).json({
          success: false,
          message: result.message,
          data: { redirectCode: result.redirectCode },
        });
      }

      return res.json({
        success: true,
        data: {
          redirectCode: result.redirectCode,
          redirectHints: result.redirectHints,
          courseEvent: result.courseEvent,
        },
      });
    } catch (err) {
      console.error('[ADMIN][COURSE-EVENT-WIZARD][EDIT-LOAD]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load event for edit',
      });
    }
  }
}

module.exports = CourseEventWizardController;
