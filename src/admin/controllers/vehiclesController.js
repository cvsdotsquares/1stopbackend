const vehiclesService = require('../services/vehiclesService');

class VehiclesController {
  constructor(pool) {
    this.pool = pool;
  }

  fail(res, err, tag, fallback) {
    console.error(`[ADMIN][VEHICLES][${tag}]`, err.message);
    return res.status(500).json({ success: false, message: fallback });
  }

  async schedule(req, res) {
    try {
      const data = await vehiclesService.getVehicleSchedule(this.pool, {
        loc_scr: req.query.loc_scr,
        name_scr: req.query.name_scr,
      });
      return res.json({ success: true, data });
    } catch (err) {
      return this.fail(res, err, 'SCHEDULE', 'Unable to load vehicle schedule');
    }
  }

  async mileages(req, res) {
    try {
      const data = await vehiclesService.getMileageGrid(this.pool, {
        loc_scr: req.query.loc_scr,
        name_scr: req.query.name_scr,
      });
      return res.json({ success: true, data });
    } catch (err) {
      return this.fail(res, err, 'MILEAGES', 'Unable to load mileages');
    }
  }

  async updateMileages(req, res) {
    try {
      const result = await vehiclesService.bulkUpdateMileages(
        this.pool,
        req.body || {}
      );
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      return this.fail(res, err, 'MILEAGES_PATCH', 'Unable to update mileages');
    }
  }

  async list(req, res) {
    try {
      const data = await vehiclesService.listVehicles(this.pool, {
        page: req.query.page,
        searchterm: { name_scr: req.query.name_scr },
      });
      return res.json({ success: true, data });
    } catch (err) {
      return this.fail(res, err, 'LIST', 'Unable to load vehicles');
    }
  }

  async search(req, res) {
    try {
      const data = await vehiclesService.searchVehicles(this.pool, req.query.q);
      return res.json({ success: true, data });
    } catch (err) {
      return this.fail(res, err, 'SEARCH', 'Unable to search vehicles');
    }
  }

  async options(req, res) {
    try {
      const data = await vehiclesService.getVehicleFormOptions(this.pool);
      return res.json({ success: true, data });
    } catch (err) {
      return this.fail(res, err, 'OPTIONS', 'Unable to load vehicle options');
    }
  }

  async getOne(req, res) {
    try {
      const vehicle = await vehiclesService.getVehicleById(
        this.pool,
        req.params.id
      );
      if (!vehicle) {
        return res.status(404).json({
          success: false,
          message: 'Vehicle not found to edit',
        });
      }
      const formOptions = await vehiclesService.getVehicleFormOptions(
        this.pool
      );
      return res.json({ success: true, data: { vehicle, formOptions } });
    } catch (err) {
      return this.fail(res, err, 'GET', 'Unable to load vehicle');
    }
  }

  async create(req, res) {
    try {
      const result = await vehiclesService.createVehicle(
        this.pool,
        req.body || {}
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
      return this.fail(res, err, 'CREATE', 'Error in adding vehicle');
    }
  }

  async update(req, res) {
    try {
      const result = await vehiclesService.updateVehicle(
        this.pool,
        req.params.id,
        req.body || {}
      );
      if (!result.ok) {
        const status = result.message.includes('not found') ? 404 : 400;
        return res.status(status).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      return this.fail(res, err, 'UPDATE', 'Error in updating vehicle');
    }
  }

  async remove(req, res) {
    try {
      const result = await vehiclesService.deleteVehicle(
        this.pool,
        req.params.id
      );
      if (!result.ok) {
        return res.status(404).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      return this.fail(res, err, 'DELETE', 'Error in deleting vehicle');
    }
  }

  async logs(req, res) {
    try {
      const result = await vehiclesService.listVehicleLogs(
        this.pool,
        req.params.id,
        {
          issue_status: req.query.scr_issue_status || req.query.issue_status,
          log_event_id: req.query.log_event_id,
          notes: req.query.notes || req.query.name_scr,
        }
      );
      if (!result.ok) {
        return res.status(404).json({ success: false, message: result.message });
      }
      return res.json({ success: true, data: result.data });
    } catch (err) {
      return this.fail(res, err, 'LOGS', 'Unable to load vehicle logs');
    }
  }

  async addLog(req, res) {
    try {
      const result = await vehiclesService.createVehicleLog(
        this.pool,
        req.params.id,
        req.body || {},
        req.session
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
      return this.fail(res, err, 'LOG_ADD', 'Error in adding vehicle log');
    }
  }

  async patchLog(req, res) {
    try {
      const result = await vehiclesService.updateVehicleLog(
        this.pool,
        req.params.logId,
        req.body || {},
        req.session
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
      return this.fail(res, err, 'LOG_PATCH', 'Error in updating vehicle log');
    }
  }

  async removeLog(req, res) {
    try {
      const result = await vehiclesService.deleteVehicleLog(
        this.pool,
        req.params.id,
        req.params.logId
      );
      return res.json({ success: true, message: result.message });
    } catch (err) {
      return this.fail(res, err, 'LOG_DEL', 'Error in deleting vehicle log');
    }
  }

  async patchLogMileage(req, res) {
    try {
      const result = await vehiclesService.updateLogMileage(
        this.pool,
        req.params.id,
        req.body?.mileage ?? req.body?.v_mileage
      );
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      return this.fail(res, err, 'LOG_MILEAGE', 'Unable to update mileage');
    }
  }

  async statusList(req, res) {
    try {
      const result = await vehiclesService.listStatusVehicles(this.pool, {
        type: req.query.type,
        color: req.query.scr_issue_status,
        loc_scr: req.query.scr_loc,
      });
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, data: result.data });
    } catch (err) {
      return this.fail(res, err, 'STATUS', 'Unable to load vehicle status');
    }
  }

  async settingTypes(req, res) {
    try {
      const data = await vehiclesService.listSettingTypes(this.pool);
      return res.json({ success: true, data });
    } catch (err) {
      return this.fail(res, err, 'SETTING_TYPES', 'Unable to load setting types');
    }
  }

  async settings(req, res) {
    try {
      const result = await vehiclesService.listSettings(
        this.pool,
        req.query.type
      );
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, data: result.data });
    } catch (err) {
      return this.fail(res, err, 'SETTINGS', 'Unable to load settings');
    }
  }

  async createSetting(req, res) {
    try {
      const result = await vehiclesService.createSetting(
        this.pool,
        req.body || {}
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
      return this.fail(res, err, 'SETTING_ADD', 'Unable to add option');
    }
  }

  async updateSetting(req, res) {
    try {
      const result = await vehiclesService.updateSetting(
        this.pool,
        req.params.id,
        req.body || {}
      );
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      return this.fail(res, err, 'SETTING_PATCH', 'Unable to update option');
    }
  }

  async removeSetting(req, res) {
    try {
      const result = await vehiclesService.deleteSetting(
        this.pool,
        req.params.id
      );
      if (!result.ok) {
        return res.status(404).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      return this.fail(res, err, 'SETTING_DEL', 'Unable to delete option');
    }
  }

  async reorderSetting(req, res) {
    try {
      const result = await vehiclesService.reorderSetting(
        this.pool,
        req.params.id,
        req.body?.direction || req.query.task
      );
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      return this.fail(res, err, 'SETTING_ORDER', 'Unable to reorder option');
    }
  }
}

module.exports = VehiclesController;
