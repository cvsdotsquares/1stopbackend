const vehiclesService = require('../services/vehiclesService');

class VehiclesController {
  constructor(pool) {
    this.pool = pool;
  }

  flashMessage(err, fallback) {
    if (err.code === 'VALIDATION' || err.code === 'DUPLICATE' || err.code === 'NOT_FOUND') {
      return err.message;
    }
    return fallback;
  }

  async schedule(req, res) {
    try {
      const data = await vehiclesService.getVehicleSchedule(this.pool, req.query);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][VEHICLES][SCHEDULE]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load vehicle schedule' });
    }
  }

  async list(req, res) {
    try {
      const data = await vehiclesService.listVehicles(this.pool, req.query);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][VEHICLES][LIST]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load vehicles' });
    }
  }

  async options(req, res) {
    try {
      const data = await vehiclesService.getVehicleFormOptions(this.pool);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][VEHICLES][OPTIONS]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load vehicle options' });
    }
  }

  async settingTypes(req, res) {
    try {
      const types = await vehiclesService.getAllVehicleSettingTypes(this.pool);
      return res.json({ success: true, data: { types } });
    } catch (err) {
      console.error('[ADMIN][VEHICLES][SETTING_TYPES]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load setting types' });
    }
  }

  async search(req, res) {
    try {
      const items = await vehiclesService.searchVehicles(this.pool, req.query.q);
      return res.json({ success: true, data: { items } });
    } catch (err) {
      console.error('[ADMIN][VEHICLES][SEARCH]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to search vehicles' });
    }
  }

  async updateMileages(req, res) {
    try {
      await vehiclesService.updateMileages(this.pool, req.body);
      return res.json({ success: true, message: 'Vehicle Mileage updated successfully' });
    } catch (err) {
      console.error('[ADMIN][VEHICLES][MILEAGES]', err.message);
      return res.status(400).json({
        success: false,
        message: this.flashMessage(err, 'Unable to update mileages'),
      });
    }
  }

  async statusPage(req, res) {
    try {
      const data = await vehiclesService.getVehicleStatusPage(this.pool, req.query);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][VEHICLES][STATUS_PAGE]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load vehicle status' });
    }
  }

  async listSettings(req, res) {
    try {
      const type = req.query.type;
      const items = await vehiclesService.listFleetSettings(this.pool, type);
      return res.json({ success: true, data: { type, items } });
    } catch (err) {
      console.error('[ADMIN][VEHICLES][SETTINGS_LIST]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load fleet settings' });
    }
  }

  async createSetting(req, res) {
    try {
      const data = await vehiclesService.createFleetSetting(this.pool, req.body);
      return res.json({ success: true, data, message: 'Option value is added successfully' });
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: this.flashMessage(err, 'Unable to add setting'),
      });
    }
  }

  async updateSetting(req, res) {
    try {
      await vehiclesService.updateFleetSetting(this.pool, req.params.id, req.body);
      return res.json({ success: true, message: 'Option value is updated successfully' });
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: this.flashMessage(err, 'Unable to update setting'),
      });
    }
  }

  async deleteSetting(req, res) {
    try {
      await vehiclesService.deleteFleetSetting(this.pool, req.params.id);
      return res.json({ success: true, message: 'Option Value is deleted successfully' });
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: this.flashMessage(err, 'Unable to delete setting'),
      });
    }
  }

  async updateLocationAjax(req, res) {
    try {
      const data = await vehiclesService.updateVehicleLocation(
        this.pool,
        req.body.vid,
        req.body.selval
      );
      return res.json(data);
    } catch (err) {
      return res.status(500).json({ status: 0, data: [], message: '' });
    }
  }

  async updateIssueStatusAjax(req, res) {
    try {
      const data = await vehiclesService.updateVehicleIssueStatusAjax(
        this.pool,
        req.body.lid,
        req.body.status
      );
      return res.json(data);
    } catch (err) {
      return res.status(500).json({ status: 0, data: [], message: '' });
    }
  }

  async getOne(req, res) {
    try {
      const vehicle = await vehiclesService.getVehicleById(this.pool, req.params.id);
      if (!vehicle) {
        return res.status(404).json({ success: false, message: 'Vehicle not found' });
      }
      const formOptions = await vehiclesService.getVehicleFormOptions(this.pool);
      return res.json({ success: true, data: { vehicle, formOptions } });
    } catch (err) {
      console.error('[ADMIN][VEHICLES][GET]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load vehicle' });
    }
  }

  async create(req, res) {
    try {
      const vehicle = await vehiclesService.createVehicle(this.pool, req.body);
      return res.json({ success: true, data: { vehicle }, message: 'Vehicle added successfully' });
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: this.flashMessage(err, 'Error in adding vehicle'),
      });
    }
  }

  async update(req, res) {
    try {
      const vehicle = await vehiclesService.updateVehicle(this.pool, req.params.id, req.body);
      return res.json({ success: true, data: { vehicle }, message: 'Vehicle updated successfully' });
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: this.flashMessage(err, 'Unable to update vehicle'),
      });
    }
  }

  async remove(req, res) {
    try {
      await vehiclesService.deleteVehicle(this.pool, req.params.id);
      return res.json({ success: true, message: 'Vehicle deleted successfully' });
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: this.flashMessage(err, 'Unable to delete vehicle'),
      });
    }
  }

  async listLogs(req, res) {
    try {
      const items = await vehiclesService.getVehicleLogs(
        this.pool,
        req.params.id,
        req.query
      );
      const vehicle = await vehiclesService.getVehicleById(this.pool, req.params.id);
      const formOptions = await vehiclesService.getVehicleFormOptions(this.pool);
      return res.json({ success: true, data: { vehicle, items, formOptions } });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Unable to load vehicle logs' });
    }
  }

  async createLog(req, res) {
    try {
      await vehiclesService.createVehicleLog(
        this.pool,
        req.params.id,
        req.body,
        req.session
      );
      return res.json({ success: true, message: 'Vehicle Log added successfully' });
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: this.flashMessage(err, 'Error in adding vehicle log'),
      });
    }
  }

  async updateLog(req, res) {
    try {
      await vehiclesService.updateVehicleLog(
        this.pool,
        req.params.logId,
        req.body,
        req.session
      );
      return res.json({ success: true, message: 'Vehicle Log updated successfully' });
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: this.flashMessage(err, 'Unable to update vehicle log'),
      });
    }
  }

  async deleteLog(req, res) {
    try {
      await vehiclesService.deleteVehicleLog(this.pool, req.params.logId);
      return res.json({ success: true, message: 'Vehicle Log deleted successfully' });
    } catch (err) {
      return res.status(400).json({ success: false, message: 'Unable to delete vehicle log' });
    }
  }
}

module.exports = VehiclesController;
