const {
  DATA_TYPE,
  listLocationCoursePages,
  getLocationCoursePageById,
  createLocationCoursePage,
  updateLocationCoursePage,
  toggleLocationCoursePageActive,
  deleteLocationCoursePage,
  getLocationEditor,
  saveLocationEditor,
  createLocationPageWithSections,
  listSectionTypes,
  removeImage,
} = require('../services/locationCoursePagesService');
const { uploadSectionImage } = require('../services/pageSections/uploadService');
const {
  addSection,
  reorderSections,
  patchInstance,
  softDeleteInstance,
  restoreInstance,
  purgeInstance,
  removeNestedItem,
} = require('../services/pageSections/instanceService');

function parseId(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function parseJsonField(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

/** Build page payload from JSON body or flattened multipart fields. */
function resolvePageBody(raw = {}) {
  if (raw.page != null) {
    return parseJsonField(raw.page, {});
  }
  const {
    sections: _sections,
    page: _page,
    ...rest
  } = raw;
  return rest;
}

function resolveSectionsBody(raw = {}) {
  if (raw.sections == null) return [];
  const parsed = parseJsonField(raw.sections, []);
  return Array.isArray(parsed) ? parsed : [];
}

class LocationCoursePagesController {
  constructor(pool) {
    this.pool = pool;
  }

  async list(req, res) {
    try {
      const data = await listLocationCoursePages(this.pool, {
        page: req.query.page,
        searchterm: {
          name_scr: req.query.name_scr,
          location_filter: req.query.location_filter,
          course_filter: req.query.course_filter,
        },
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][LCP][LIST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load location course pages',
      });
    }
  }

  async formOptions(req, res) {
    try {
      const [[locations], [courses]] = await Promise.all([
        this.pool.query(
          `SELECT id, location_name
           FROM locations
           WHERE status = '1'
           ORDER BY location_name ASC`
        ),
        this.pool.query(
          `SELECT id, course_name
           FROM courses
           WHERE status = '1' AND isDeleted = '0'
           ORDER BY course_name ASC`
        ),
      ]);
      return res.json({
        success: true,
        data: {
          locations: (locations || []).map((row) => ({
            id: row.id,
            label: row.location_name,
          })),
          courses: (courses || []).map((row) => ({
            id: row.id,
            label: row.course_name,
          })),
        },
      });
    } catch (err) {
      console.error('[ADMIN][LCP][FORM_OPTIONS]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load form options',
      });
    }
  }

  async getById(req, res) {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(404).json({ success: false, message: 'Page not found' });
      }
      const page = await getLocationCoursePageById(this.pool, id);
      if (!page) {
        return res.status(404).json({ success: false, message: 'Page not found' });
      }
      return res.json({ success: true, data: page });
    } catch (err) {
      console.error('[ADMIN][LCP][GET]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load page',
      });
    }
  }

  async create(req, res) {
    try {
      const result = await createLocationCoursePage(
        this.pool,
        resolvePageBody(req.body || {}),
        req.file || null
      );
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
      console.error('[ADMIN][LCP][CREATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in adding location course page',
      });
    }
  }

  async update(req, res) {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(404).json({
          success: false,
          message: 'Page not found to update',
        });
      }
      const result = await updateLocationCoursePage(
        this.pool,
        id,
        resolvePageBody(req.body || {}),
        req.file || null
      );
      if (!result.ok) {
        return res
          .status(result.message.includes('not found') ? 404 : 400)
          .json({ success: false, message: result.message });
      }
      return res.json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (err) {
      console.error('[ADMIN][LCP][UPDATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to update location course page',
      });
    }
  }

  async toggleActive(req, res) {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(404).json({
          success: false,
          message: 'Page not found',
        });
      }
      const result = await toggleLocationCoursePageActive(this.pool, id);
      if (!result.ok) {
        return res.status(404).json({ success: false, message: result.message });
      }
      return res.json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (err) {
      console.error('[ADMIN][LCP][ACTIVE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to update page status',
      });
    }
  }

  async remove(req, res) {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(404).json({
          success: false,
          message: 'Page not found to delete',
        });
      }
      const result = await deleteLocationCoursePage(this.pool, id);
      if (!result.ok) {
        return res
          .status(result.message.includes('not found') ? 404 : 400)
          .json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][LCP][DELETE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in deleting page',
      });
    }
  }

  async getEditor(req, res) {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(404).json({ success: false, message: 'Page not found' });
      }
      const result = await getLocationEditor(this.pool, id);
      if (!result.ok) {
        return res.status(404).json({ success: false, message: result.message });
      }
      return res.json({ success: true, data: result.data });
    } catch (err) {
      console.error('[ADMIN][LCP][EDITOR][GET]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load page editor',
      });
    }
  }

  async saveEditor(req, res) {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(404).json({ success: false, message: 'Page not found' });
      }
      const result = await saveLocationEditor(this.pool, id, req.body || {});
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({
        success: true,
        message: 'Page saved successfully',
        data: result.data,
      });
    } catch (err) {
      console.error('[ADMIN][LCP][EDITOR][PUT]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to save page editor',
      });
    }
  }

  async createWithSections(req, res) {
    try {
      const raw = req.body || {};
      const body = {
        page: resolvePageBody(raw),
        sections: resolveSectionsBody(raw),
      };
      const result = await createLocationPageWithSections(
        this.pool,
        body,
        req.file || null
      );
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.status(201).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (err) {
      console.error('[ADMIN][LCP][CREATE_WITH_SECTIONS]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in adding location course page',
      });
    }
  }

  async sectionTypes(req, res) {
    try {
      const pageId = req.query.page_id ? parseId(req.query.page_id) : null;
      const types = await listSectionTypes(this.pool, pageId, DATA_TYPE);
      return res.json({ success: true, data: { types } });
    } catch (err) {
      console.error('[ADMIN][LCP][SECTION_TYPES]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load section types',
      });
    }
  }

  async addSection(req, res) {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(404).json({ success: false, message: 'Page not found' });
      }
      const type = String(req.body?.type || '').trim();
      if (!type) {
        return res.status(400).json({
          success: false,
          message: 'Section type is required',
        });
      }
      const result = await addSection(this.pool, id, type, DATA_TYPE);
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.status(201).json({ success: true, data: result.data });
    } catch (err) {
      console.error('[ADMIN][LCP][ADD_SECTION]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to add section',
      });
    }
  }

  async reorder(req, res) {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(404).json({ success: false, message: 'Page not found' });
      }
      await reorderSections(this.pool, id, req.body?.ordered || [], DATA_TYPE);
      return res.json({ success: true, message: 'Sections reordered' });
    } catch (err) {
      console.error('[ADMIN][LCP][REORDER]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to reorder sections',
      });
    }
  }

  async patchSection(req, res) {
    try {
      const pageId = parseId(req.params.id);
      const instanceId = parseId(req.params.instanceId);
      if (!pageId || !instanceId) {
        return res.status(404).json({
          success: false,
          message: 'Section instance not found',
        });
      }
      const result = await patchInstance(
        this.pool,
        pageId,
        instanceId,
        req.body || {}
      );
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, data: result.data });
    } catch (err) {
      console.error('[ADMIN][LCP][PATCH_SECTION]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to update section',
      });
    }
  }

  async deleteSection(req, res) {
    try {
      const pageId = parseId(req.params.id);
      const instanceId = parseId(req.params.instanceId);
      if (!pageId || !instanceId) {
        return res.status(404).json({
          success: false,
          message: 'Section instance not found',
        });
      }
      const purge = String(req.query.purge || '') === '1';
      const result = purge
        ? await purgeInstance(this.pool, pageId, instanceId)
        : await softDeleteInstance(this.pool, pageId, instanceId);
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][LCP][DELETE_SECTION]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to delete section',
      });
    }
  }

  async restoreSection(req, res) {
    try {
      const pageId = parseId(req.params.id);
      const instanceId = parseId(req.params.instanceId);
      if (!pageId || !instanceId) {
        return res.status(404).json({
          success: false,
          message: 'Section instance not found',
        });
      }
      const result = await restoreInstance(this.pool, pageId, instanceId);
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, data: result.data });
    } catch (err) {
      console.error('[ADMIN][LCP][RESTORE_SECTION]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to restore section',
      });
    }
  }

  async deleteItem(req, res) {
    try {
      const pageId = parseId(req.params.id);
      const instanceId = parseId(req.params.instanceId);
      const itemId = parseId(req.params.itemId);
      if (!pageId || !instanceId || !itemId) {
        return res.status(404).json({
          success: false,
          message: 'Item not found',
        });
      }
      const result = await removeNestedItem(
        this.pool,
        pageId,
        instanceId,
        itemId
      );
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: 'Item removed' });
    } catch (err) {
      console.error('[ADMIN][LCP][DELETE_ITEM]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to remove item',
      });
    }
  }

  async uploadImage(req, res) {
    try {
      const result = uploadSectionImage(req.file, req.body?.folder);
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.status(201).json({ success: true, data: result.data });
    } catch (err) {
      console.error('[ADMIN][LCP][UPLOAD_IMAGE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to upload image',
      });
    }
  }

  async removeImage(req, res) {
    try {
      const result = await removeImage(this.pool, req.body || {});
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][LCP][REMOVE_IMAGE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to remove image',
      });
    }
  }
}

module.exports = LocationCoursePagesController;
