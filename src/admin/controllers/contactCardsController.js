const {
  listContactCards,
  getContactCard,
  createContactCard,
  updateContactCard,
  deleteContactCard,
} = require('../services/contactCardsService');

class ContactCardsController {
  constructor(pool) {
    this.pool = pool;
  }

  parseId(req) {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return null;
    }
    return id;
  }

  async list(req, res) {
    try {
      const data = await listContactCards(this.pool, {
        page: req.query.page,
        name_scr: req.query.name_scr,
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][CONTACT-CARDS][LIST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load contact cards',
      });
    }
  }

  async getOne(req, res) {
    try {
      const id = this.parseId(req);
      if (!id) {
        return res.status(404).json({
          success: false,
          message: 'Contact not found to edit',
        });
      }

      const result = await getContactCard(this.pool, id);
      if (!result.ok) {
        return res.status(404).json({
          success: false,
          message: result.message,
        });
      }

      return res.json({ success: true, data: result.data });
    } catch (err) {
      console.error('[ADMIN][CONTACT-CARDS][GET]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Contact not found to edit',
      });
    }
  }

  async create(req, res) {
    try {
      const result = await createContactCard(this.pool, req.body || {});
      if (!result.ok) {
        const status = result.code === 'duplicate_license' ? 409 : 400;
        return res.status(status).json({
          success: false,
          message: result.message,
          code: result.code,
        });
      }

      return res.json({
        success: true,
        message: result.message,
        data: { id: result.id },
      });
    } catch (err) {
      console.error('[ADMIN][CONTACT-CARDS][CREATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in adding contact',
      });
    }
  }

  async update(req, res) {
    try {
      const id = this.parseId(req);
      if (!id) {
        return res.status(404).json({
          success: false,
          message: 'Contact not found to edit',
        });
      }

      const result = await updateContactCard(this.pool, id, req.body || {});
      if (!result.ok) {
        const status =
          result.message === 'Contact not found to edit'
            ? 404
            : result.code === 'duplicate_license'
              ? 409
              : 400;
        return res.status(status).json({
          success: false,
          message: result.message,
          code: result.code,
        });
      }

      return res.json({
        success: true,
        message: result.message,
      });
    } catch (err) {
      console.error('[ADMIN][CONTACT-CARDS][UPDATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in updating contact',
      });
    }
  }

  async remove(req, res) {
    try {
      const id = this.parseId(req);
      if (!id) {
        return res.status(404).json({
          success: false,
          message: 'Contact not found to delete',
        });
      }

      const result = await deleteContactCard(this.pool, id);
      if (!result.ok) {
        const status = result.message === 'Contact not found to delete' ? 404 : 400;
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
      console.error('[ADMIN][CONTACT-CARDS][DELETE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in deleting contact',
      });
    }
  }
}

module.exports = ContactCardsController;
