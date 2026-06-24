const {
  listFranchises,
  getFranchiseById,
  getLocationOptions,
  createFranchise,
  updateFranchise,
  updateFranchiseStatus,
  softDeleteFranchise,
  setPrimaryFranchise,
  clearFranchiseFileField,
  getFranchiseUploadBaseUrl,
} = require('../services/franchisesService');

class FranchisesController {
  constructor(pool) {
    this.pool = pool;
  }

  getUploadsBaseUrl(req) {
    return getFranchiseUploadBaseUrl(req);
  }

  async list(req, res) {
    try {
      const data = await listFranchises(this.pool, {
        page: req.query.page,
        searchterm: {
          name_scr: req.query.name_scr,
          add_scr: req.query.add_scr,
          sort: req.query.sort,
        },
        uploadsBaseUrl: this.getUploadsBaseUrl(req),
      });

      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][FRANCHISES][LIST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load franchises',
      });
    }
  }

  async getOne(req, res) {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(404).json({
          success: false,
          message: 'Franchise not found to edit',
        });
      }

      const franchise = await getFranchiseById(
        this.pool,
        id,
        this.getUploadsBaseUrl(req)
      );
      if (!franchise || franchise.isDeleted === '1') {
        return res.status(404).json({
          success: false,
          message: 'Franchise not found to edit',
        });
      }

      const locationOptions = await getLocationOptions(this.pool);
      return res.json({
        success: true,
        data: { franchise, locationOptions },
      });
    } catch (err) {
      console.error('[ADMIN][FRANCHISES][GET]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load franchise',
      });
    }
  }

  async create(req, res) {
    try {
      const result = await createFranchise(
        this.pool,
        req.body || {},
        req.files || {}
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
      console.error('[ADMIN][FRANCHISES][CREATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in adding franchise',
      });
    }
  }

  async update(req, res) {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(404).json({
          success: false,
          message: 'Franchise not found to edit',
        });
      }

      const result = await updateFranchise(
        this.pool,
        id,
        req.body || {},
        req.files || {}
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
      console.error('[ADMIN][FRANCHISES][UPDATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in updating franchise',
      });
    }
  }

  async updateStatus(req, res) {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(404).json({
          success: false,
          message: 'Franchise not found',
        });
      }

      const result = await updateFranchiseStatus(
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
      console.error('[ADMIN][FRANCHISES][STATUS]', err.message);
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
          message: 'Franchise not found to delete',
        });
      }

      const result = await softDeleteFranchise(this.pool, id);
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
      console.error('[ADMIN][FRANCHISES][DELETE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in deleting franchise',
      });
    }
  }

  async setPrimary(req, res) {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(404).json({
          success: false,
          message: 'Franchise not found',
        });
      }

      const result = await setPrimaryFranchise(this.pool, id);
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
      console.error('[ADMIN][FRANCHISES][SET_PRIMARY]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in change position',
      });
    }
  }

  async clearFileField(req, res) {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(404).json({
          success: false,
          message: 'Franchise not found to edit',
        });
      }

      const result = await clearFranchiseFileField(this.pool, id, {
        fileName: req.body?.fileName,
        fieldName: req.body?.fieldName,
        rowId: req.body?.rowId,
      });

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
      console.error('[ADMIN][FRANCHISES][CLEAR_FILE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error clearing file field',
      });
    }
  }
}

module.exports = FranchisesController;
