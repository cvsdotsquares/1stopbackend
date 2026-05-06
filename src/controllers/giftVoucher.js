const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { sendGiftVoucherEmail } = require('../utils/emailService');
const { findOrCreateStripeCustomerByEmail } = require('../utils/stripeCustomer');

class GiftVoucherController {
  constructor(pool) {
    this.pool = pool;
  }

  async getVoucherEmailPayload(voucherId, userId, userEmail) {
    const [vouchers] = await this.pool.query(
      `SELECT
        gv.id,
        gv.voucher_ref,
        gv.voucher_date,
        gv.subject,
        gv.voucher_person,
        gv.voucher_value,
        gv.voucher_free_text,
        gv.purchased_by,
        gv.voucher_contact,
        gv.voucher_email,
        gv.user_id,
        gv.created
      FROM gift_voucher gv
      WHERE gv.id = ? AND (gv.user_id = ? OR gv.voucher_email = ?)
      LIMIT 1`,
      [voucherId, userId, userEmail]
    );

    return vouchers[0] || null;
  }

  async createVoucher(req, res) {
    try {
      const {
        recipient_name,
        voucher_value,
        purchased_by,
        contact_number,
        email_address,
        field_text,
        subject,
        user_id = 0
      } = req.body;

      // Validate
      if (!recipient_name || !voucher_value || !purchased_by || !email_address || !subject) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields'
        });
      }

      const connection = await this.pool.getConnection();

      try {
        await connection.beginTransaction();

        // SOLUTION: Actually insert a placeholder row in bookings table to claim the ID
        // This permanently reserves the booking ID for this gift voucher
        const [bookingInsert] = await connection.query(
          `INSERT INTO bookings
           (course_id, course_event_id, user_id, type_of_book, spaces, payment_due,
            total_fees, vatrate, vat, total_amount, admin_payment_received, status,
            lockid, edit_payment_type, edited_booking_id, created_by, booking_made_by, created, modified)
           VALUES (0, 0, ?, 'o', 0, 0, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 'gift_voucher', NOW(), NOW())`,
          [user_id || 0]
        );

        const bid = bookingInsert.insertId;
        console.log(`🎫 Reserved booking ID ${bid} for gift voucher`);
        console.log(`[BOOKING STATUS] INSERT bookings status=0 (PENDING_PAYMENT) | source=controllers/giftVoucher.js (gift voucher placeholder) | booking_id=${bid} | user_id=${user_id || 0}`);

        // Generate voucher reference
        const voucher_ref = `1SGV${bid} - OGV`;
        const voucher_date = new Date().toLocaleDateString('en-GB');

        // Insert into gift_voucher_copieds
        const [insertResult] = await connection.query(
          `INSERT INTO gift_voucher_copieds
           (bid, voucher_ref, voucher_date, subject, voucher_person, voucher_free_text,
            voucher_value, purchased_by, voucher_contact, voucher_email,
            voucher_payement_type, template_id, created, franchise_to_paid, user_id, redeem_note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'o', 1, NOW(), 1, ?, '')`,
          [bid, voucher_ref, voucher_date, subject || '', recipient_name, field_text || '',
           voucher_value, purchased_by, contact_number, email_address, user_id]
        );

        console.log(`✅ Inserted into gift_voucher_copieds with bid ${bid}, row ID: ${insertResult.insertId}`);

        // Gift vouchers should be charged at face value only.
        // Do not add VAT at purchase time.
        const voucherValueNumeric = Number(voucher_value) || 0;
        const vat = 0;
        const totalAmount = voucherValueNumeric;

        // Attach a Stripe Customer keyed by the purchaser's email so each
        // unique buyer gets a dedicated customer record in the dashboard.
        const stripeCustomerId = await findOrCreateStripeCustomerByEmail({
          email: email_address,
          name: purchased_by,
          phone: contact_number,
          metadata: {
            type: 'gift_voucher',
            voucher_ref: voucher_ref || '',
            user_id: String(user_id || '')
          }
        });

        // Create Stripe PaymentIntent for inline payment
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(totalAmount * 100),
          currency: 'gbp',
          automatic_payment_methods: { enabled: true },
          ...(stripeCustomerId ? { customer: stripeCustomerId } : {}),
          metadata: {
            type: 'gift_voucher',
            bid: bid.toString(),
            voucher_ref,
            recipient_name,
            purchased_by
          },
          description: `Gift Voucher for ${recipient_name} - ${subject || 'Training Course'}`,
          receipt_email: email_address
        });

        // Commit the transaction
        await connection.commit();
        console.log(`✅ Gift voucher creation completed successfully for bid ${bid}`);

        res.json({
          success: true,
          voucher_ref,
          bid,
          client_secret: paymentIntent.client_secret,
          payment_intent_id: paymentIntent.id,
          voucher_value: voucherValueNumeric,
          vat,
          total_amount: totalAmount
        });

      } catch (error) {
        await connection.rollback();
        console.error(`❌ Error creating gift voucher:`, error);
        console.error('Error details:', {
          message: error.message,
          code: error.code,
          stack: error.stack
        });
        throw error;
      } finally {
        connection.release();
      }

    } catch (error) {
      console.error('❌ CRITICAL: Error creating gift voucher:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create gift voucher',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  async getVoucherById(req, res) {
    try {
      const { id } = req.params;
      const user_id = req.user.id;
      const user_email = req.user.email;

      const [vouchers] = await this.pool.query(
        `SELECT
          gv.id,
          gv.voucher_ref,
          gv.voucher_date,
          gv.subject as course_name,
          gv.voucher_person as recipient_name,
          gv.voucher_free_text as message,
          gv.voucher_value as value,
          gv.purchased_by,
          gv.voucher_contact as contact_number,
          gv.voucher_email as email,
          gv.user_id,
          gv.template_id,
          gv.created,
          DATE_ADD(gv.created, INTERVAL 12 MONTH) as valid_till,
          CASE
            WHEN gv.user_id = ? THEN 'purchased'
            ELSE 'received'
          END as voucher_type,
          CASE
            WHEN gv.redeem_note != '' THEN 'redeemed'
            WHEN DATE_ADD(gv.created, INTERVAL 12 MONTH) < NOW() THEN 'expired'
            ELSE 'active'
          END as status
        FROM gift_voucher gv
        WHERE gv.id = ? AND (gv.user_id = ? OR gv.voucher_email = ?)`,
        [user_id, id, user_id, user_email]
      );

      if (vouchers.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Gift voucher not found'
        });
      }

      res.json({
        success: true,
        data: vouchers[0]
      });

    } catch (error) {
      console.error('Error fetching gift voucher:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch gift voucher'
      });
    }
  }

  async getVoucherConfirmationPreview(req, res) {
    try {
      const voucherId = Number.parseInt(req.params.id, 10);
      const userId = req.user.id;
      const userEmail = req.user.email;

      const voucher = await this.getVoucherEmailPayload(voucherId, userId, userEmail);
      if (!voucher) {
        return res.status(404).json({
          success: false,
          error: 'Gift voucher not found'
        });
      }

      const previewResult = await sendGiftVoucherEmail({
        ...voucher,
        targetEmail: userEmail,
        previewOnly: true
      }, this.pool);

      return res.json({
        success: true,
        data: {
          subject: previewResult.subject,
          to: previewResult.to,
          html: previewResult.html
        }
      });
    } catch (error) {
      console.error('Error fetching gift voucher confirmation preview:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch gift voucher confirmation preview'
      });
    }
  }

  async sendVoucherConfirmationEmail(req, res) {
    try {
      const voucherId = Number.parseInt(req.params.id, 10);
      const userId = req.user.id;
      const userEmail = req.user.email;
      const forwardEmail = String(req.body?.email || '').trim();

      if (forwardEmail && !/^\S+@\S+\.\S+$/.test(forwardEmail)) {
        return res.status(400).json({
          success: false,
          error: 'Please provide a valid email address'
        });
      }

      const voucher = await this.getVoucherEmailPayload(voucherId, userId, userEmail);
      if (!voucher) {
        return res.status(404).json({
          success: false,
          error: 'Gift voucher not found'
        });
      }

      const recipientEmail = forwardEmail || userEmail;
      await sendGiftVoucherEmail({
        ...voucher,
        targetEmail: recipientEmail,
        previewOnly: false
      }, this.pool);

      return res.json({
        success: true,
        message: forwardEmail
          ? `Gift voucher confirmation forwarded to ${recipientEmail}`
          : `Gift voucher confirmation sent to ${recipientEmail}`
      });
    } catch (error) {
      console.error('Error sending gift voucher confirmation email:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to send gift voucher confirmation email'
      });
    }
  }

  async verifyVoucher(req, res) {
    try {
      const { session_id, ref } = req.query;

      if (!session_id || !ref) {
        return res.status(400).json({
          success: false,
          error: 'Missing session_id or ref'
        });
      }

      const session = await stripe.checkout.sessions.retrieve(session_id);

      const [vouchers] = await this.pool.query(
        `SELECT * FROM gift_voucher WHERE voucher_ref = ?`,
        [ref]
      );

      res.json({
        success: true,
        data: {
          payment_status: session.payment_status,
          voucher_ref: ref,
          voucher_exists: vouchers.length > 0
        }
      });

    } catch (error) {
      console.error('Error verifying voucher:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to verify voucher'
      });
    }
  }

  async getVoucherTemplate(req, res) {
    try {
      const { id = 1 } = req.query;

      // Get template details
      const [templates] = await this.pool.query(
        `SELECT details FROM voucher_templates WHERE id = ?`,
        [id]
      );

      if (templates.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Voucher template not found'
        });
      }

      // Get gift options
      const [options] = await this.pool.query(
        `SELECT gift_option FROM gift_voucher_options WHERE voucher_template_id = ?`,
        [id]
      );

      res.json({
        success: true,
        data: {
          template: templates[0],
          options: options.map(opt => opt.gift_option)
        }
      });

    } catch (error) {
      console.error('Error fetching voucher template:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch voucher template'
      });
    }
  }
}

module.exports = GiftVoucherController;
