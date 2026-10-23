const vehiclesService = require('../../admin/services/vehiclesService');

class InstructorVehiclesController {
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
      console.error('[INSTRUCTOR][VEHICLES][SCHEDULE]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load vehicle schedule' });
    }
  }

  async options(req, res) {
    try {
      const data = await vehiclesService.getVehicleFormOptions(this.pool);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[INSTRUCTOR][VEHICLES][OPTIONS]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load vehicle options' });
    }
  }

  async updateMileages(req, res) {
    try {
      await vehiclesService.updateMileages(this.pool, req.body);
      return res.json({ success: true, message: 'Vehicle Mileage updated successfully' });
    } catch (err) {
      console.error('[INSTRUCTOR][VEHICLES][MILEAGES]', err.message);
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
      console.error('[INSTRUCTOR][VEHICLES][STATUS_PAGE]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load vehicle status' });
    }
  }

  async getOne(req, res) {
    try {
      const vehicle = await vehiclesService.getVehicleById(this.pool, req.params.id);
      if (!vehicle) {
        return res.status(404).json({ success: false, message: 'Vehicle not found' });
      }
      return res.json({ success: true, data: vehicle });
    } catch (err) {
      console.error('[INSTRUCTOR][VEHICLES][GET]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load vehicle' });
    }
  }

  async getLogs(req, res) {
    try {
      const vehicleId = req.params.id;
      const vehicle = await vehiclesService.getVehicleById(this.pool, vehicleId);
      if (!vehicle) {
        return res.status(404).json({ success: false, message: 'Vehicle not found' });
      }
      const items = await vehiclesService.getVehicleLogs(this.pool, vehicleId, req.query);
      const formOptions = await vehiclesService.getVehicleFormOptions(this.pool);
      let editLog = null;
      const editLogId = String(req.query.lid ?? '').trim();
      if (editLogId) {
        editLog = await vehiclesService.getVehicleLogById(this.pool, vehicleId, editLogId);
      }
      return res.json({
        success: true,
        data: {
          vehicle: {
            ...vehicle,
            current_mileage: Number(vehicle.mileage) || 0,
          },
          items,
          formOptions,
          editLog,
        },
      });
    } catch (err) {
      console.error('[INSTRUCTOR][VEHICLES][LOGS]', err.message);
      return res.status(500).json({
        success: false,
        message: this.flashMessage(err, 'Unable to load vehicle logs'),
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
      console.error('[INSTRUCTOR][VEHICLES][UPDATE_LOG]', err.message);
      return res.status(400).json({
        success: false,
        message: this.flashMessage(err, 'Unable to update vehicle log'),
      });
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
      return res.json({ success: true, message: 'Vehicle log entry added successfully' });
    } catch (err) {
      console.error('[INSTRUCTOR][VEHICLES][CREATE_LOG]', err.message);
      return res.status(400).json({
        success: false,
        message: this.flashMessage(err, 'Unable to add log entry'),
      });
    }
  }

  async deleteLog(req, res) {
    try {
      await vehiclesService.deleteVehicleLog(this.pool, req.params.logId);
      return res.json({ success: true, message: 'Vehicle Log deleted successfully' });
    } catch (err) {
      console.error('[INSTRUCTOR][VEHICLES][DELETE_LOG]', err.message);
      return res.status(400).json({ success: false, message: 'Unable to delete vehicle log' });
    }
  }

  async updateLocation(req, res) {
    try {
      const data = await vehiclesService.updateVehicleLocation(
        this.pool,
        req.body.vid,
        req.body.selval
      );
      const ok = Number(data?.status) === 1;
      return res.json({
        success: ok,
        data,
        message: ok ? '' : 'Unable to update vehicle location',
      });
    } catch (err) {
      console.error('[INSTRUCTOR][VEHICLES][UPDATE_LOCATION]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to update vehicle location' });
    }
  }

  async updateIssueStatus(req, res) {
    try {
      const { lid, status } = req.body || {};
      const result = await vehiclesService.updateVehicleIssueStatusAjax(
        this.pool,
        lid,
        status
      );
      return res.json({ success: true, ...result });
    } catch (err) {
      console.error('[INSTRUCTOR][VEHICLES][UPDATE_ISSUE_STATUS]', err.message);
      return res.status(400).json({ success: false, message: 'Unable to update issue status' });
    }
  }
}

module.exports = InstructorVehiclesController;
