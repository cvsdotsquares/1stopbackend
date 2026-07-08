const {
  listBlacklistedClients,
  fetchLicenceDetails,
  markAsBlacklisted,
  removeFromBlacklist,
} = require('../services/blacklistedClientsService');

class BlacklistedClientsController {
  constructor(pool) {
    this.pool = pool;
  }

  parseClientId(req) {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return null;
    }
    return id;
  }

  async list(req, res) {
    try {
      const data = await listBlacklistedClients(this.pool, {
        page: req.query.page,
        name_scr: req.query.name_scr,
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][BLACKLISTED-CLIENTS][LIST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load blacklisted clients',
      });
    }
  }

  async licenceLookup(req, res) {
    try {
      const result = await fetchLicenceDetails(
        this.pool,
        req.body?.licence_no ?? req.body?.licence_number
      );
      return res.json({
        status: result.status,
        success: result.status === 1,
        data: result.data,
        message: result.message,
      });
    } catch (err) {
      console.error('[ADMIN][BLACKLISTED-CLIENTS][LICENCE-LOOKUP]', err.message);
      return res.status(500).json({
        status: 0,
        success: false,
        data: null,
        message: 'Unable to look up licence details',
      });
    }
  }

  async updateBlacklist(req, res) {
    try {
      const clientId = this.parseClientId(req);
      if (!clientId) {
        return res.status(404).json({
          success: false,
          message: 'Contact not found',
        });
      }

      const action = String(req.body?.action || '').trim().toLowerCase();
      let result;

      if (action === 'add') {
        result = await markAsBlacklisted(this.pool, clientId, req.body?.notes);
      } else if (action === 'remove') {
        result = await removeFromBlacklist(this.pool, clientId);
      } else {
        return res.status(400).json({
          success: false,
          message: 'Invalid blacklist action',
        });
      }

      if (!result.ok) {
        const status =
          result.message === 'Contact not found to remove from blacklist' ||
          result.message === 'Contact not found'
            ? 404
            : 400;
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
      console.error('[ADMIN][BLACKLISTED-CLIENTS][UPDATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to update blacklist status',
      });
    }
  }
}

module.exports = BlacklistedClientsController;
