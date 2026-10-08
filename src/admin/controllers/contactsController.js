const {
  listContactOffices,
  getContactOfficeById,
  createContactOffice,
  updateContactOffice,
  deleteContactOffice,
} = require('../services/contactsService');

class ContactsController {
  constructor(pool) {
    this.pool = pool;
  }

  async list(req, res) {
    try {
      const data = await listContactOffices(this.pool, {
        page: req.query.page,
        name_scr: req.query.name_scr,
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][CONTACTS][LIST]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load contact offices' });
    }
  }

  async getOne(req, res) {
    try {
      const row = await getContactOfficeById(this.pool, req.params.id);
      if (!row) {
        return res.status(404).json({ success: false, message: 'Contact office not found' });
      }
      return res.json({ success: true, data: row });
    } catch (err) {
      console.error('[ADMIN][CONTACTS][GET]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load contact office' });
    }
  }

  async create(req, res) {
    try {
      const result = await createContactOffice(this.pool, req.body || {});
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.status(201).json({
        success: true,
        message: result.message,
        data: { id: result.id },
      });
    } catch (err) {
      console.error('[ADMIN][CONTACTS][CREATE]', err.message);
      return res.status(500).json({ success: false, message: 'Error adding contact office' });
    }
  }

  async update(req, res) {
    try {
      const result = await updateContactOffice(this.pool, req.params.id, req.body || {});
      if (!result.ok) {
        const status = result.message.includes('not found') ? 404 : 400;
        return res.status(status).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][CONTACTS][UPDATE]', err.message);
      return res.status(500).json({ success: false, message: 'Error updating contact office' });
    }
  }

  async remove(req, res) {
    try {
      const result = await deleteContactOffice(this.pool, req.params.id);
      if (!result.ok) {
        return res.status(404).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][CONTACTS][DELETE]', err.message);
      return res.status(500).json({ success: false, message: 'Error deleting contact office' });
    }
  }
}

module.exports = ContactsController;
