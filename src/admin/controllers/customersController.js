const customersService = require('../services/customersService');

class CustomersController {
  constructor(pool) {
    this.pool = pool;
  }

  async listContactCards(req, res) {
    try {
      const data = await customersService.listContactCards(this.pool, {
        page: req.query.page,
        searchterm: { name_scr: req.query.name_scr },
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][CUSTOMERS][CONTACT_CARDS][LIST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load contact cards',
      });
    }
  }

  async getContactCard(req, res) {
    try {
      const card = await customersService.getContactCardById(
        this.pool,
        req.params.id
      );
      if (!card) {
        return res.status(404).json({
          success: false,
          message: 'Contact card not found',
        });
      }
      return res.json({ success: true, data: card });
    } catch (err) {
      console.error('[ADMIN][CUSTOMERS][CONTACT_CARDS][GET]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load contact card',
      });
    }
  }

  async createContactCard(req, res) {
    try {
      const result = await customersService.createContactCard(
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
      console.error('[ADMIN][CUSTOMERS][CONTACT_CARDS][CREATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in adding contact card',
      });
    }
  }

  async updateContactCard(req, res) {
    try {
      const result = await customersService.updateContactCard(
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
      console.error('[ADMIN][CUSTOMERS][CONTACT_CARDS][UPDATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in updating contact card',
      });
    }
  }

  async deleteContactCard(req, res) {
    try {
      const result = await customersService.deleteContactCard(
        this.pool,
        req.params.id
      );
      if (!result.ok) {
        return res.status(404).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][CUSTOMERS][CONTACT_CARDS][DELETE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in deleting contact card',
      });
    }
  }

  async listBlacklisted(req, res) {
    try {
      const data = await customersService.listBlacklisted(this.pool, {
        page: req.query.page,
        searchterm: { name_scr: req.query.name_scr },
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][CUSTOMERS][BLACKLISTED][LIST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load blacklisted clients',
      });
    }
  }

  async fetchLicenceDetails(req, res) {
    try {
      const result = await customersService.fetchLicenceDetails(
        this.pool,
        req.query.licence_no || req.body?.licence_no
      );
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, data: result.data });
    } catch (err) {
      console.error('[ADMIN][CUSTOMERS][LICENCE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to look up licence',
      });
    }
  }

  async setBlacklist(req, res) {
    try {
      const blacklisted =
        req.body?.blacklisted === false ||
        req.body?.blacklisted === 0 ||
        req.body?.blacklisted === '0'
          ? false
          : true;
      const result = await customersService.setContactBlacklist(
        this.pool,
        req.params.id,
        { blacklisted, notes: req.body?.notes }
      );
      if (!result.ok) {
        return res.status(404).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][CUSTOMERS][BLACKLIST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to update blacklist',
      });
    }
  }

  async listDeletedBookings(req, res) {
    try {
      const data = await customersService.listDeletedBookings(this.pool, {
        page: req.query.page,
        searchterm: { name_scr: req.query.name_scr },
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][CUSTOMERS][DELETED][LIST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load deleted bookings',
      });
    }
  }

  async purgeDeletedBooking(req, res) {
    try {
      const result = await customersService.purgeDeletedBooking(
        this.pool,
        req.params.id
      );
      if (!result.ok) {
        return res.status(404).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][CUSTOMERS][DELETED][PURGE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to permanently delete booking',
      });
    }
  }

  async listAttending(req, res) {
    try {
      const data = await customersService.listAttendingCustomers(this.pool, {
        page: req.query.page,
        searchterm: { name_scr: req.query.name_scr },
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][CUSTOMERS][ATTENDING][LIST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load attending customers',
      });
    }
  }

  async listMembers(req, res) {
    try {
      const data = await customersService.listMembers(this.pool, {
        page: req.query.page,
        searchterm: {
          name_scr: req.query.name_scr,
          status_scr: req.query.status_scr,
        },
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][CUSTOMERS][MEMBERS][LIST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load members',
      });
    }
  }

  async getMember(req, res) {
    try {
      const member = await customersService.getMemberById(
        this.pool,
        req.params.id
      );
      if (!member) {
        return res.status(404).json({
          success: false,
          message: 'Member not found',
        });
      }
      return res.json({ success: true, data: member });
    } catch (err) {
      console.error('[ADMIN][CUSTOMERS][MEMBERS][GET]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load member',
      });
    }
  }

  async updateMember(req, res) {
    try {
      const result = await customersService.updateMember(
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
      console.error('[ADMIN][CUSTOMERS][MEMBERS][UPDATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in updating member',
      });
    }
  }

  async listMemberBookings(req, res) {
    try {
      const result = await customersService.listMemberBookings(
        this.pool,
        req.params.id
      );
      if (!result.ok) {
        return res.status(404).json({ success: false, message: result.message });
      }
      return res.json({ success: true, data: result.data });
    } catch (err) {
      console.error('[ADMIN][CUSTOMERS][MEMBERS][BOOKINGS]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load member bookings',
      });
    }
  }
}

module.exports = CustomersController;
