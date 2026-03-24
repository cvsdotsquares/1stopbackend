const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

class GiftVoucherController {
  constructor(pool) {
    this.pool = pool;
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
      if (!recipient_name || !voucher_value || !purchased_by || !email_address) {
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


        // Calculate total with VAT
        const vat = voucher_value * 0.2;
        const totalAmount = voucher_value + vat;

        // Create Stripe PaymentIntent for inline payment
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(totalAmount * 100),
          currency: 'gbp',
          automatic_payment_methods: { enabled: true },
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

        res.json({
          success: true,
          voucher_ref,
          bid,
          client_secret: paymentIntent.client_secret,
          payment_intent_id: paymentIntent.id,
          voucher_value,
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
