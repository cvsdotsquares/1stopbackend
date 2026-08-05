const {
  getEditor,
  saveEditor,
  createPageWithSections,
  listSectionTypes,
  removeImage,
} = require('../services/pageSections/editorService');
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

class PagesEditorController {
  constructor(pool) {
    this.pool = pool;
  }

  async getEditor(req, res) {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(404).json({ success: false, message: 'Page not found' });
      }
      const result = await getEditor(this.pool, id);
      if (!result.ok) {
        return res.status(404).json({ success: false, message: result.message });
      }
      return res.json({ success: true, data: result.data });
    } catch (err) {
      console.error('[ADMIN][PAGES][EDITOR][GET]', err.message);
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
      const result = await saveEditor(this.pool, id, req.body || {});
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({
        success: true,
        message: 'Page saved successfully',
        data: result.data,
      });
    } catch (err) {
      console.error('[ADMIN][PAGES][EDITOR][PUT]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to save page editor',
      });
    }
  }

  async createWithSections(req, res) {
    try {
      const result = await createPageWithSections(this.pool, req.body || {});
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.status(201).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (err) {
      console.error('[ADMIN][PAGES][CREATE_WITH_SECTIONS]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in adding page',
      });
    }
  }

  async sectionTypes(req, res) {
    try {
      const pageId = req.query.page_id ? parseId(req.query.page_id) : null;
      const types = await listSectionTypes(this.pool, pageId);
      return res.json({ success: true, data: { types } });
    } catch (err) {
      console.error('[ADMIN][PAGES][SECTION_TYPES]', err.message);
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
      const result = await addSection(this.pool, id, type);
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.status(201).json({ success: true, data: result.data });
    } catch (err) {
      console.error('[ADMIN][PAGES][ADD_SECTION]', err.message);
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
      await reorderSections(this.pool, id, req.body?.ordered || []);
      return res.json({ success: true, message: 'Sections reordered' });
    } catch (err) {
      console.error('[ADMIN][PAGES][REORDER]', err.message);
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
      const result = await patchInstance(this.pool, pageId, instanceId, req.body || {});
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, data: result.data });
    } catch (err) {
      console.error('[ADMIN][PAGES][PATCH_SECTION]', err.message);
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
      console.error('[ADMIN][PAGES][DELETE_SECTION]', err.message);
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
      console.error('[ADMIN][PAGES][RESTORE_SECTION]', err.message);
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
      const result = await removeNestedItem(this.pool, pageId, instanceId, itemId);
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: 'Item removed' });
    } catch (err) {
      console.error('[ADMIN][PAGES][DELETE_ITEM]', err.message);
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
      console.error('[ADMIN][PAGES][UPLOAD_IMAGE]', err.message);
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
      console.error('[ADMIN][PAGES][REMOVE_IMAGE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to remove image',
      });
    }
  }
}

module.exports = PagesEditorController;
