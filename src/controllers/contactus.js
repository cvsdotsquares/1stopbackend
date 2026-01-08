// src/controllers/contactus.js
/**
 * Contact Us Controller - handles contact us content from existing tables
 */

const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
dotenv.config();

class ContactUsController {
  constructor(pool) {
    this.pool = pool;

    // Initialize SMTP transporter once per controller instance
    try {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587,
        secure: (process.env.SMTP_SECURE === 'true'), // true for 465, false for other ports
        auth: process.env.SMTP_USER && process.env.SMTP_PASS ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        } : undefined
      });
    } catch (err) {
      console.error('Failed to create SMTP transporter:', err);
      this.transporter = null;
    }
  }

  async getContactUsContent(req, res) {
    try {
        const pageId = '58';

        const contactContent = {
            page_title: "Contact Us",
            meta_title: "Contact Us - 1Stop Instruction",
            meta_desc: "Get in touch with 1Stop Instruction for any inquiries or support.",
            meta_keyword: "contact, support, inquiries, 1Stop Instruction",
            page_content: "Feel free to reach out to us through any of the following methods.",
            banner_type: 2,
            overlay_caption: 0,
            overlay_caption_text: "",
            carousel_static_image: "",
            carousel_static_caption: "",
            page_ex_rhs: "",
            featured_service: 0,
            featured_icon: "",
            testimonial_display: 0,
            featured_display: 0,
            accreditation_display: 0,
            contact_offices: [
                {
                    id: 0,
                    lname: "",
                    latitude: "",
                    longitude: "",
                    content: "",
                    weight: 0,
                    status: 1
                }
            ]
        };

        // Fetch dynamic content from the database if needed

        const [content] = await this.pool.query(`
        SELECT page_title, meta_title, meta_desc, meta_keyword, page_content, banner_type, overlay_caption,
               overlay_caption_text, carousel_static_image, carousel_static_caption,
               page_ex_rhs, featured_service, featured_icon, testimonial_display, featured_display, accreditation_display
        FROM pages
        WHERE id = ?
      `, [pageId]);

        const [offices] = await this.pool.query(`
        SELECT id, lname, latitude, longitude, content, weight, status
        FROM contact_offices
        WHERE status = 1
        ORDER BY weight ASC
      `);

        if (content.length > 0) {
            Object.assign(contactContent, content[0]);
        }
        if (offices.length > 0) {
            contactContent.contact_offices = offices.map(office => ({
                id: office.id,
                lname: office.lname,
                latitude: office.latitude,
                longitude: office.longitude,
                content: office.content,
                weight: office.weight,
                status: office.status
            }));
        }
        res.json({ success: true, data: contactContent });
    } catch (error) {
      console.error('Error fetching contact us content:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  async createContactUsEntry(req, res) {
    try {
      const { name, email, subject, message } = req.body;
      require('assert')(name, 'Name is required');
      require('assert')(email, 'Email is required');
      require('assert')(subject, 'Subject is required');
      require('assert')(message, 'Message is required');

      // Check if the email is valid
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (!emailRegex.test(email)) {
        return res.status(400).json({ success: false, message: 'Invalid email format' });
      }



      // Prepare email
      const toAddress = process.env.CONTACT_TO || process.env.SMTP_USER;
      const fromAddress = process.env.CONTACT_FROM || process.env.SMTP_USER;
      const bccAddress = process.env.CONTACT_BCC || '';
      const officerDesignation = process.env.CONTACT_TO_OFFICER || 'Enquiry manager';

      const mailOptions = {
        from: fromAddress,
        to: toAddress,
        replyTo: email,
        subject: `Contact form submission: ${subject}`,
        text: `You have a new contact form submission:\n\nName: ${name}\nEmail: ${email}\nSubject: ${subject}\nMessage:\n${message}`,
        html: `<p>You have a new contact form submission:</p>
               <p><strong>Name:</strong> ${name}</p>
               <p><strong>Email:</strong> ${email}</p>
               <p><strong>Subject:</strong> ${subject}</p>
               <p><strong>Message:</strong><br/>${message.replace(/\n/g, '<br/>')}</p>`
      };

      // Send email if transporter is configured
      let mailInfo = null;
      if (this.transporter) {
        try {
          mailInfo = await this.transporter.sendMail(mailOptions);

          // If message was successfully sent, log it into the database
          if (mailInfo && mailInfo.messageId) {

            var getIP = require('ipware')().get_ip;
            app.use(function(req, res, next) {
                var ipInfo = getIP(req);
                console.log(ipInfo);
                next();
            });
            // await this.pool.query(`
            //   INSERT INTO contact_us_messages (to, from, subject, email_content, email_by, status, type, ip)
            //   VALUES (?, ?, ?, ?, ?, NOW())
            // `, [name, email, subject, message, mailInfo.messageId]);
          }
        } catch (mailErr) {
          console.error('Failed to send contact email:', mailErr);
          // don't fail the whole request if email fails; proceed to return success for DB insert
        }
      } else {
        console.warn('No SMTP transporter configured - skipping sending email');
      }

      // Return success response including DB insert id
      return res.json({ success: true, message: 'Contact entry received', id: result.insertId || null, mail: mailInfo ? { messageId: mailInfo.messageId } : null });
    } catch (error) {
      console.error('Error creating contact us entry:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
}

module.exports = ContactUsController;