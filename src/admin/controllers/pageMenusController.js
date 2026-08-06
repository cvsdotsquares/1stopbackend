const {
  listPageMenus,
  getPageMenuById,
  getFormOptions,
  createPageMenu,
  updatePageMenu,
  deletePageMenu,
  updateSortOrder,
  updateGroupSort,
  listMenuGroups,
  createMenuGroup,
  renameMenuGroup,
  deleteMenuGroup,
  listGroupMenus,
} = require('../services/pageMenusService');

function parseId(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

class PageMenusController {
  constructor(pool) {
    this.pool = pool;
  }

  async list(req, res) {
    try {
      const data = await listPageMenus(this.pool);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][PAGE_MENUS][LIST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load page menus',
      });
    }
  }

  async formOptions(req, res) {
    try {
      const excludeMenuId = req.query.exclude_id
        ? parseId(req.query.exclude_id)
        : null;
      const groupName = req.query.group ? String(req.query.group) : null;
      const data = await getFormOptions(this.pool, {
        excludeMenuId,
        groupName,
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][PAGE_MENUS][OPTIONS]', err.message);
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
        return res.status(404).json({ success: false, message: 'Page Menu not found' });
      }
      const menu = await getPageMenuById(this.pool, id);
      if (!menu) {
        return res.status(404).json({ success: false, message: 'Page Menu not found' });
      }
      return res.json({ success: true, data: menu });
    } catch (err) {
      console.error('[ADMIN][PAGE_MENUS][GET]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load page menu',
      });
    }
  }

  async create(req, res) {
    try {
      const result = await createPageMenu(this.pool, req.body || {});
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.status(201).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (err) {
      console.error('[ADMIN][PAGE_MENUS][CREATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error adding page menu',
      });
    }
  }

  async update(req, res) {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(404).json({ success: false, message: 'Page Menu not found' });
      }
      const result = await updatePageMenu(this.pool, id, req.body || {});
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
      console.error('[ADMIN][PAGE_MENUS][UPDATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error updating page menu',
      });
    }
  }

  async remove(req, res) {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(404).json({
          success: false,
          message: 'Page Menu not found',
        });
      }
      const result = await deletePageMenu(this.pool, id);
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][PAGE_MENUS][DELETE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error deleting page menu',
      });
    }
  }

  async updateSort(req, res) {
    try {
      const result = await updateSortOrder(this.pool, req.body?.ids || []);
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][PAGE_MENUS][SORT]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to update sort order',
      });
    }
  }

  async updateGroupSort(req, res) {
    try {
      const result = await updateGroupSort(this.pool, req.body?.items || []);
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (err) {
      console.error('[ADMIN][PAGE_MENUS][GROUP_SORT]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to update hierarchy',
      });
    }
  }

  async listGroups(req, res) {
    try {
      const data = await listMenuGroups(this.pool);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][MENU_GROUPS][LIST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load menu groups',
      });
    }
  }

  async createGroup(req, res) {
    try {
      const result = await createMenuGroup(this.pool, req.body || {});
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.status(201).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (err) {
      console.error('[ADMIN][MENU_GROUPS][CREATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error adding menu group',
      });
    }
  }

  async renameGroup(req, res) {
    try {
      const oldName = req.body?.old_group_name || req.params.groupName;
      const result = await renameMenuGroup(
        this.pool,
        oldName,
        req.body?.group_name
      );
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (err) {
      console.error('[ADMIN][MENU_GROUPS][RENAME]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error renaming group',
      });
    }
  }

  async deleteGroup(req, res) {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(404).json({ success: false, message: 'Group not found' });
      }
      const result = await deleteMenuGroup(this.pool, id);
      if (!result.ok) {
        return res
          .status(result.message.includes('not found') ? 404 : 400)
          .json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][MENU_GROUPS][DELETE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error deleting menu group',
      });
    }
  }

  async listGroupMenus(req, res) {
    try {
      const groupName = decodeURIComponent(req.params.groupName || '');
      const result = await listGroupMenus(this.pool, groupName);
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, data: result.data });
    } catch (err) {
      console.error('[ADMIN][MENU_GROUPS][MENUS]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load group menus',
      });
    }
  }
}

module.exports = PageMenusController;
