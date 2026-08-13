const {
  listGiftVouchers,
  getGiftVoucherById,
  createGiftVoucher,
  updateGiftVoucher,
  deleteGiftVoucher,
  getGiftVoucherPrintData,
  getVoucherTemplate,
  updateVoucherTemplate,
  getVoucherFormOptions,
  getFranchiseForVoucher,
  redeemGiftVoucher,
} = require('../services/giftVouchersService');

class GiftVouchersController {
  constructor(pool) {
    this.pool = pool;
  }

  async list(req, res) {
    try {
      const data = await listGiftVouchers(this.pool, {
        page: req.query.page,
        searchterm: { name_scr: req.query.name_scr },
        redeemed: 'No',
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][GIFT_VOUCHERS][LIST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load gift vouchers',
      });
    }
  }

  async listRedeemed(req, res) {
    try {
      const data = await listGiftVouchers(this.pool, {
        page: req.query.page,
        searchterm: { name_scr: req.query.name_scr },
        redeemed: 'Yes',
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][GIFT_VOUCHERS][REDEEMED]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load redeemed vouchers',
      });
    }
  }

  async options(req, res) {
    try {
      const data = await getVoucherFormOptions(this.pool);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][GIFT_VOUCHERS][OPTIONS]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load gift voucher options',
      });
    }
  }

  async getTemplate(req, res) {
    try {
      const data = await getVoucherTemplate(this.pool);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][GIFT_VOUCHERS][TEMPLATE_GET]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load voucher template',
      });
    }
  }

  async updateTemplate(req, res) {
    try {
      const result = await updateVoucherTemplate(this.pool, req.body || {});
      return res.json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (err) {
      console.error('[ADMIN][GIFT_VOUCHERS][TEMPLATE_PATCH]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in updating template',
      });
    }
  }

  async getFranchise(req, res) {
    try {
      const franchise = await getFranchiseForVoucher(this.pool, req.params.id);
      if (!franchise) {
        return res.json({ success: true, data: {} });
      }
      return res.json({
        success: true,
        data: {
          telephone: franchise.telephone || '',
          freephone: franchise.freephone || '',
          website: franchise.website || '',
          franchise_email: franchise.franchise_email || '',
        },
      });
    } catch (err) {
      console.error('[ADMIN][GIFT_VOUCHERS][FRANCHISE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load franchise',
      });
    }
  }

  async getOne(req, res) {
    try {
      const voucher = await getGiftVoucherById(this.pool, req.params.id);
      if (!voucher) {
        return res.status(404).json({
          success: false,
          message: 'Gift Voucher not found to edit',
        });
      }
      const formOptions = await getVoucherFormOptions(this.pool);
      return res.json({
        success: true,
        data: { voucher, formOptions },
      });
    } catch (err) {
      console.error('[ADMIN][GIFT_VOUCHERS][GET]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load gift voucher',
      });
    }
  }

  async print(req, res) {
    try {
      const data = await getGiftVoucherPrintData(this.pool, req.params.id);
      if (!data) {
        return res.status(404).json({
          success: false,
          message: 'Gift Voucher not found',
        });
      }
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][GIFT_VOUCHERS][PRINT]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load gift voucher print data',
      });
    }
  }

  async create(req, res) {
    try {
      const result = await createGiftVoucher(this.pool, req.body || {});
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
      console.error('[ADMIN][GIFT_VOUCHERS][CREATE]', err.message);
      return res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Error in adding gift voucher',
      });
    }
  }

  async update(req, res) {
    try {
      const result = await updateGiftVoucher(
        this.pool,
        req.params.id,
        req.body || {}
      );
      if (!result.ok) {
        const status = result.message.includes('not found') ? 404 : 400;
        return res.status(status).json({
          success: false,
          message: result.message,
        });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][GIFT_VOUCHERS][UPDATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in updating gift voucher',
      });
    }
  }

  async remove(req, res) {
    try {
      const result = await deleteGiftVoucher(this.pool, req.params.id);
      if (!result.ok) {
        const status = result.message.includes('not found') ? 404 : 400;
        return res.status(status).json({
          success: false,
          message: result.message,
        });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][GIFT_VOUCHERS][DELETE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in deleting gift voucher',
      });
    }
  }

  async redeem(req, res) {
    try {
      const result = await redeemGiftVoucher(
        this.pool,
        req.params.id,
        req.body || {}
      );
      if (!result.ok) {
        const status = result.message.includes('not found') ? 404 : 400;
        return res.status(status).json({
          success: false,
          message: result.message,
        });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][GIFT_VOUCHERS][REDEEM]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in redeeming gift voucher',
      });
    }
  }
}

module.exports = GiftVouchersController;
