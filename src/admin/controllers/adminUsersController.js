const {
  listAdminUsers,
  getAdminUserById,
  createAdminUser,
  updateAdminUser,
  toggleAdminUserStatus,
  deleteAdminUser,
} = require('../services/adminUsersService');

class AdminUsersController {
  constructor(pool) {
    this.pool = pool;
  }

  async list(req, res) {
    try {
      const page = req.query.page || 1;
      const limit = req.query.limit || 10;
      const search = req.query.search || '';

      const result = await listAdminUsers(this.pool, { page, limit, search });
      return res.json({ success: true, data: result, ...result });
    } catch (err) {
      console.error('[ADMIN][USERS][LIST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load admin users',
      });
    }
  }

  async getOne(req, res) {
    try {
      const user = await getAdminUserById(this.pool, req.params.id);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'Admin user not found',
        });
      }
      return res.json({ success: true, data: user });
    } catch (err) {
      console.error('[ADMIN][USERS][GET_ONE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to retrieve admin user',
      });
    }
  }

  async create(req, res) {
    try {
      const result = await createAdminUser(this.pool, req.body || {});
      if (!result.ok) {
        return res.status(400).json({
          success: false,
          message: result.message,
        });
      }
      return res.status(201).json({
        success: true,
        message: result.message,
        id: result.id,
      });
    } catch (err) {
      console.error('[ADMIN][USERS][CREATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to create admin user',
      });
    }
  }

  async update(req, res) {
    try {
      const result = await updateAdminUser(this.pool, req.params.id, req.body || {});
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
      console.error('[ADMIN][USERS][UPDATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to update admin user',
      });
    }
  }

  async toggleStatus(req, res) {
    try {
      const { status } = req.body || {};
      const result = await toggleAdminUserStatus(this.pool, req.params.id, status !== undefined ? status : null);
      if (!result.ok) {
        return res.status(400).json({
          success: false,
          message: result.message,
        });
      }
      return res.json({
        success: true,
        message: result.message,
        status: result.status,
      });
    } catch (err) {
      console.error('[ADMIN][USERS][TOGGLE_STATUS]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to toggle user status',
      });
    }
  }

  async delete(req, res) {
    try {
      const result = await deleteAdminUser(this.pool, req.params.id);
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
      console.error('[ADMIN][USERS][DELETE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to delete admin user',
      });
    }
  }
}

module.exports = AdminUsersController;
