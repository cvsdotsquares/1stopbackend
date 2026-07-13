const {
  listLocations,
  getLocationById,
  createLocation,
  updateLocation,
  softDeleteLocation,
  getMapsPublicBaseUrl,
} = require('../services/locationsService');

class LocationsController {
  constructor(pool) {
    this.pool = pool;
  }

  async list(req, res) {
    try {
      const mapsBaseUrl = getMapsPublicBaseUrl(req);
      const data = await listLocations(this.pool, {
        page: req.query.page,
        searchterm: {
          name_scr: req.query.name_scr,
          add_scr: req.query.add_scr,
          sort: req.query.sort,
        },
        mapsBaseUrl,
      });

      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][LOCATIONS][LIST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load locations',
      });
    }
  }

  async getOne(req, res) {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(404).json({
          success: false,
          message: 'Location not found to edit',
        });
      }

      const mapsBaseUrl = getMapsPublicBaseUrl(req);
      const location = await getLocationById(this.pool, id, mapsBaseUrl);
      if (!location) {
        return res.status(404).json({
          success: false,
          message: 'Location not found to edit',
        });
      }

      return res.json({ success: true, data: location });
    } catch (err) {
      console.error('[ADMIN][LOCATIONS][GET]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load location',
      });
    }
  }

  async create(req, res) {
    try {
      const result = await createLocation(
        this.pool,
        req.body || {},
        req.file
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
      console.error('[ADMIN][LOCATIONS][CREATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in adding location',
      });
    }
  }

  async update(req, res) {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(404).json({
          success: false,
          message: 'Location not found to edit',
        });
      }

      const mapsBaseUrl = getMapsPublicBaseUrl(req);
      const existing = await getLocationById(this.pool, id, mapsBaseUrl);
      if (!existing) {
        return res.status(404).json({
          success: false,
          message: 'Location not found to edit',
        });
      }

      const result = await updateLocation(
        this.pool,
        id,
        { ...(req.body || {}), id: String(id) },
        req.file,
        existing.direction_map
      );

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
      console.error('[ADMIN][LOCATIONS][UPDATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in updating location',
      });
    }
  }

  async remove(req, res) {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(404).json({
          success: false,
          message: 'Location not found to delete',
        });
      }

      const result = await softDeleteLocation(this.pool, id);
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
      console.error('[ADMIN][LOCATIONS][DELETE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in deleting location',
      });
    }
  }
}

module.exports = LocationsController;
