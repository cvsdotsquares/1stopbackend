const {
  refundBooking,
  deleteBooking,
  getDeleteMailTemplate,
} = require('../services/bookingRefundDeleteService');
const {
  getBookingView,
  getBookingEdit,
  previewEditEvent,
  updateBooking,
} = require('../services/bookingViewEditService');
const {
  getInvoice,
  saveInvoice,
  sendInvoiceEmail,
} = require('../services/bookingInvoiceService');

function trim(value) {
  return value == null ? '' : String(value).trim();
}

class BookingsController {
  constructor(pool) {
    this.pool = pool;
  }

  parseBookingId(req) {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return null;
    }
    return id;
  }

  parseBookingParam(req) {
    const raw = String(req.params.id || '').trim();
    return raw || null;
  }

  getAdminId(req) {
    const adminId = req.session?.loggedinAdmin?.admin_id;
    const parsed = Number(adminId);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  async refund(req, res) {
    try {
      const bookingId = this.parseBookingId(req);
      if (!bookingId) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found to refund',
        });
      }

      const result = await refundBooking(this.pool, bookingId, req);
      if (!result.ok) {
        const status = result.message === 'Booking not found to refund' ? 404 : 400;
        return res.status(status).json({
          success: false,
          message: result.message,
        });
      }

      return res.json({
        success: true,
        message: result.message,
        data: { courseEventId: result.courseEventId },
      });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][REFUND]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in refund for bookings',
      });
    }
  }

  async remove(req, res) {
    try {
      const bookingId = this.parseBookingId(req);
      if (!bookingId) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found to delete',
        });
      }

      const result = await deleteBooking(
        this.pool,
        bookingId,
        req.body || {},
        this.getAdminId(req),
        req
      );

      if (!result.ok) {
        const status = result.message === 'Booking not found to delete' ? 404 : 400;
        return res.status(status).json({
          success: false,
          message: result.message,
        });
      }

      return res.json({
        success: true,
        message: result.message,
        data: { courseEventId: result.courseEventId },
      });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][DELETE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in deleting bookings',
      });
    }
  }

  async view(req, res) {
    try {
      const idParam = this.parseBookingParam(req);
      if (!idParam) {
        return res.status(404).json({
          success: false,
          message: 'Booking/Gift Voucher not found to view',
        });
      }

      const result = await getBookingView(this.pool, idParam);
      if (!result.ok) {
        if (result.deleted) {
          return res.status(404).json({
            success: false,
            message: result.message,
            data: {
              redirectDeleted: true,
              deletedBookingId: result.deletedBookingId,
            },
          });
        }
        return res.status(404).json({
          success: false,
          message: result.message || 'Booking/Gift Voucher not found to view',
        });
      }

      return res.json({
        success: true,
        data: result.data,
      });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][VIEW]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Booking/Gift Voucher not found to view',
      });
    }
  }

  async edit(req, res) {
    try {
      const bookingId = this.parseBookingId(req);
      if (!bookingId) {
        return res.status(400).json({
          success: false,
          message: 'Invalid Booking, Try again',
        });
      }

      const newEventId = trim(req.query.newEventId);
      const result = await getBookingEdit(
        this.pool,
        bookingId,
        req.session,
        newEventId || null
      );

      if (!result.ok) {
        return res.status(400).json({
          success: false,
          message: result.message || 'Invalid Booking, Try again',
        });
      }

      const blacklisted = req.session?.blacklisted;
      return res.json({
        success: true,
        data: {
          ...result.data,
          blacklisted: blacklisted?.status === 1 ? blacklisted : null,
        },
      });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][EDIT]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Invalid Booking, Try again',
      });
    }
  }

  async previewEvent(req, res) {
    try {
      const bookingId = this.parseBookingId(req);
      const newEventId = Number(req.query.newEventId);
      if (!bookingId || !Number.isFinite(newEventId) || newEventId <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid Booking, Try again',
        });
      }

      const result = await previewEditEvent(
        this.pool,
        bookingId,
        newEventId,
        req.session
      );

      if (!result.ok) {
        return res.status(400).json({
          success: false,
          message: result.message || 'Invalid Booking, Try again',
        });
      }

      return res.json({
        success: true,
        data: result.data,
      });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][EDIT_PREVIEW]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Invalid Booking, Try again',
      });
    }
  }

  async patch(req, res) {
    try {
      const bookingId = this.parseBookingId(req);
      if (!bookingId) {
        return res.status(400).json({
          success: false,
          message: 'Invalid Booking, Try again',
        });
      }

      const result = await updateBooking(
        this.pool,
        bookingId,
        req.body || {},
        this.getAdminId(req),
        req.session,
        req
      );

      if (!result.ok) {
        return res.status(400).json({
          success: false,
          message: result.message,
          blacklisted: result.blacklisted || null,
        });
      }

      return res.json({
        success: true,
        message: result.message,
        messages: result.messages,
        data: { bookingId: result.bookingId },
        flashType: result.flashType || 'success',
      });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][PATCH]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Invalid Booking, Try again',
      });
    }
  }

  async deleteMailTemplate(req, res) {
    try {
      const bookingId = this.parseBookingId(req);
      if (!bookingId) {
        return res.json({ success: false, status: 0, data: null });
      }

      const result = await getDeleteMailTemplate(this.pool, bookingId);
      if (!result.ok) {
        return res.json({ success: false, status: 0, data: null });
      }

      return res.json({
        success: true,
        status: 1,
        data: result.data,
      });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][DELETE_TEMPLATE]', err.message);
      return res.status(500).json({
        success: false,
        status: 0,
        message: 'Unable to load delete mail template',
      });
    }
  }

  async getInvoice(req, res) {
    try {
      const bookingId = this.parseBookingId(req);
      if (!bookingId) {
        return res.status(400).json({
          success: false,
          message: 'Invalid Booking, Try again',
        });
      }

      const editable = trim(req.query.edit) === '1' || trim(req.query.edit) === 'true';
      const result = await getInvoice(this.pool, bookingId, editable, req);
      if (!result.ok) {
        return res.status(400).json({
          success: false,
          message: result.message || 'Invalid Booking, Try again',
        });
      }

      return res.json({
        success: true,
        data: result.data,
      });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][INVOICE_GET]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Invalid Booking, Try again',
      });
    }
  }

  async saveInvoice(req, res) {
    try {
      const bookingId = this.parseBookingId(req);
      if (!bookingId) {
        return res.status(400).json({
          success: false,
          message: 'Invalid Booking, Try again',
        });
      }

      const result = await saveInvoice(this.pool, bookingId, req.body || {});
      if (!result.ok) {
        return res.status(400).json({
          success: false,
          message: result.message || 'Error in saving invoice',
        });
      }

      return res.json({
        success: true,
        message: result.message,
      });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][INVOICE_SAVE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in saving invoice',
      });
    }
  }

  async emailInvoice(req, res) {
    try {
      const bookingId = this.parseBookingId(req);
      if (!bookingId) {
        return res.status(400).json({
          success: false,
          message: 'Invalid Booking, Try again',
        });
      }

      const email = trim(req.body?.email_invoice || req.body?.emailInvoice);
      const result = await sendInvoiceEmail(this.pool, bookingId, email, req);
      if (!result.ok) {
        return res.status(400).json({
          success: false,
          message: result.message || 'Error on sending email',
        });
      }

      return res.json({
        success: true,
        message: result.message,
      });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][INVOICE_EMAIL]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error on sending email',
      });
    }
  }
}

module.exports = BookingsController;
