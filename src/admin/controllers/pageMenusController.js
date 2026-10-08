const {
  listPageMenusTree,
  listMenuGroups,
  createMenuGroup,
  deleteMenuGroup,
  renameMenuGroup,
  getPageMenuById,
  createPageMenu,
  updatePageMenu,
  deletePageMenu,
  updateGroupSort,
  updateFlatSort,
  getPageMenuFormOptions,
} = require('../services/pageMenusService');

class PageMenusController {
  constructor(pool) {
    this.pool = pool;
  }

  async list(req, res) {
    return this.tree(req, res);
  }

  async tree(req, res) {
    try {
      const data = await listPageMenusTree(this.pool);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][PAGE_MENUS][TREE]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load page menus' });
    }
  }

  async options(req, res) {
    try {
      const data = await getPageMenuFormOptions(this.pool);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][PAGE_MENUS][OPTIONS]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load menu options' });
    }
  }

  async listGroups(req, res) {
    try {
      const groups = await listMenuGroups(this.pool);
      return res.json({ success: true, data: { groups } });
    } catch (err) {
      console.error('[ADMIN][PAGE_MENUS][GROUPS]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load menu groups' });
    }
  }

  async createGroup(req, res) {
    try {
      const result = await createMenuGroup(this.pool, req.body || {});
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.status(201).json({ success: true, message: result.message, data: { id: result.id } });
    } catch (err) {
      console.error('[ADMIN][PAGE_MENUS][CREATE_GROUP]', err.message);
      return res.status(500).json({ success: false, message: 'Error adding menu group' });
    }
  }

  async deleteGroup(req, res) {
    try {
      const result = await deleteMenuGroup(this.pool, req.params.id);
      if (!result.ok) {
        return res.status(404).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][PAGE_MENUS][DELETE_GROUP]', err.message);
      return res.status(500).json({ success: false, message: 'Error deleting menu group' });
    }
  }

  async renameGroup(req, res) {
    try {
      const result = await renameMenuGroup(
        this.pool,
        req.body?.oldName ?? req.body?.old_name,
        req.body?.newName ?? req.body?.new_name
      );
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][PAGE_MENUS][RENAME_GROUP]', err.message);
      return res.status(500).json({ success: false, message: 'Error renaming group' });
    }
  }

  async getOne(req, res) {
    try {
      const menu = await getPageMenuById(this.pool, req.params.id);
      if (!menu) {
        return res.status(404).json({ success: false, message: 'Page Menu not found' });
      }
      const formOptions = await getPageMenuFormOptions(this.pool);
      return res.json({ success: true, data: { menu, formOptions } });
    } catch (err) {
      console.error('[ADMIN][PAGE_MENUS][GET]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load page menu' });
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
        data: { id: result.id },
      });
    } catch (err) {
      console.error('[ADMIN][PAGE_MENUS][CREATE]', err.message);
      return res.status(500).json({ success: false, message: 'Error adding page menu' });
    }
  }

  async update(req, res) {
    try {
      const result = await updatePageMenu(this.pool, req.params.id, req.body || {});
      if (!result.ok) {
        const status = result.message.includes('not found') ? 404 : 400;
        return res.status(status).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][PAGE_MENUS][UPDATE]', err.message);
      return res.status(500).json({ success: false, message: 'Error updating page menu' });
    }
  }

  async remove(req, res) {
    try {
      const result = await deletePageMenu(this.pool, req.params.id);
      if (!result.ok) {
        return res.status(404).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][PAGE_MENUS][DELETE]', err.message);
      return res.status(500).json({ success: false, message: 'Error deleting page menu' });
    }
  }

  async reorderGroup(req, res) {
    try {
      const items = req.body?.items;
      const result = await updateGroupSort(this.pool, items);
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({
        success: true,
        message: result.message,
        count: result.count,
      });
    } catch (err) {
      console.error('[ADMIN][PAGE_MENUS][REORDER]', err.message);
      return res.status(500).json({ success: false, message: 'Error updating hierarchy' });
    }
  }

  async reorderFlat(req, res) {
    try {
      const ids = req.body?.ids;
      const result = await updateFlatSort(this.pool, ids);
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][PAGE_MENUS][REORDER_FLAT]', err.message);
      return res.status(500).json({ success: false, message: 'Error updating sort order' });
    }
  }
}

module.exports = PageMenusController;
