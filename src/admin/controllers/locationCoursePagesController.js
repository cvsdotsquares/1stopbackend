const {
  listLocationCoursePages,
  loadNewLocationCourseEditor,
  loadLocationCourseEditor,
  createLocationCoursePage,
  updateLocationCourseCore,
  deleteLocationCoursePage,
  toggleLocationCourseActive,
} = require('../services/locationCoursePagesService');
const { savePageSections } = require('../services/pageEditor/savePageSections');
const {
  removePageSection,
  removeSectionItem,
  updateSectionSortOrder,
} = require('../services/pageSectionsRemoveService');
const { nestFormBody } = require('../utils/nestFormBody');

function mapFiles(req) {
  return (req.files || []).map((f) => ({
    fieldname: f.fieldname,
    buffer: f.buffer,
    originalname: f.originalname,
    mimetype: f.mimetype,
  }));
}

class LocationCoursePagesController {
  constructor(pool) {
    this.pool = pool;
  }

  async list(req, res) {
    try {
      const data = await listLocationCoursePages(this.pool, {
        page: req.query.page,
        name_scr: req.query.name_scr,
        location_filter: req.query.location_filter,
        course_filter: req.query.course_filter,
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][LCP][LIST]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load location-course pages' });
    }
  }

  async getNewEditor(req, res) {
    try {
      const data = await loadNewLocationCourseEditor(this.pool);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][LCP][NEW_EDITOR]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load form' });
    }
  }

  async getEditor(req, res) {
    try {
      const data = await loadLocationCourseEditor(this.pool, req.params.id);
      if (!data) {
        return res.status(404).json({ success: false, message: 'Page not found to edit' });
      }
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][LCP][EDITOR_GET]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load editor' });
    }
  }

  async create(req, res) {
    const conn = await this.pool.getConnection();
    try {
      const body = nestFormBody(req.body || {});
      const files = mapFiles(req);
      await conn.beginTransaction();

      const result = await createLocationCoursePage(conn, body, files);
      if (!result.ok) {
        await conn.rollback();
        return res.status(400).json({ success: false, message: result.message });
      }

      const id = result.id;
      body.id = id;
      body.page_id = id;

      await savePageSections(conn, {
        pageId: id,
        dataType: 'location',
        body,
        files,
      });

      await conn.commit();
      return res.json({ success: true, message: result.message, data: { id } });
    } catch (err) {
      await conn.rollback();
      console.error('[ADMIN][LCP][CREATE]', err);
      return res.status(500).json({ success: false, message: 'Error in adding page' });
    } finally {
      conn.release();
    }
  }

  async saveEditor(req, res) {
    const conn = await this.pool.getConnection();
    try {
      const id = Number(req.params.id);
      const body = nestFormBody(req.body || {});
      body.id = body.id || id;
      body.page_id = body.page_id || id;
      const files = mapFiles(req);

      await conn.beginTransaction();
      const coreResult = await updateLocationCourseCore(conn, id, body, files);
      if (!coreResult.ok) {
        await conn.rollback();
        return res.status(400).json({ success: false, message: coreResult.message });
      }

      await savePageSections(conn, {
        pageId: id,
        dataType: 'location',
        body,
        files,
      });

      await conn.commit();
      return res.json({ success: true, message: coreResult.message, data: { id } });
    } catch (err) {
      await conn.rollback();
      console.error('[ADMIN][LCP][EDITOR_SAVE]', err);
      return res.status(500).json({ success: false, message: 'Error in updating page' });
    } finally {
      conn.release();
    }
  }

  async remove(req, res) {
    try {
      const result = await deleteLocationCoursePage(this.pool, req.params.id);
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][LCP][DELETE]', err.message);
      return res.status(500).json({ success: false, message: 'Error deleting location-course page' });
    }
  }

  async toggleActive(req, res) {
    try {
      const result = await toggleLocationCourseActive(this.pool, req.params.id);
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({
        success: true,
        message: result.message,
        data: { is_active: result.is_active },
      });
    } catch (err) {
      console.error('[ADMIN][LCP][TOGGLE]', err.message);
      return res.status(500).json({ success: false, message: 'Error updating status' });
    }
  }

  async removeSection(req, res) {
    try {
      const result = await removePageSection(this.pool, {
        pageId: req.body.page_id,
        pageType: req.body.pageType || 'location',
        slider_type: req.body.slider_type,
        section_id: req.body.section_id,
      });
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Unable to remove section' });
    }
  }

  async removeItem(req, res) {
    try {
      const result = await removeSectionItem(this.pool, {
        sectiontype: req.body.sectiontype,
        section_id: req.body.section_id,
        itemid: req.body.itemid,
      });
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Unable to remove item' });
    }
  }

  async sortSection(req, res) {
    try {
      const result = await updateSectionSortOrder(this.pool, {
        page_id: req.body.page_id,
        section_type: req.body.section_type,
        sort_order: req.body.sort_order,
        sectionId: req.body.sectionId,
        page_type: req.body.page_type || 'location',
      });
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ status: 'success', message: result.message });
    } catch (err) {
      return res.status(500).json({ status: 'error', message: 'Failed to update sort order' });
    }
  }
}

module.exports = LocationCoursePagesController;
