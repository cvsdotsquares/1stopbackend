const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

exports.sendOTPEmail = async (email, firstName, otp) => {
  const mailOptions = {
    from: process.env.SMTP_USER,
    to: email,
    subject: 'Email Verification - 1Stop Training',
    html: `
      <h2>Email Verification</h2>
      <p>Hi ${firstName},</p>
      <p>Your verification code is: <strong>${otp}</strong></p>
      <p>This code will expire in 10 minutes.</p>
      <p>If you didn't request this, please ignore this email.</p>
    `
  };

  return transporter.sendMail(mailOptions);
};

exports.sendBookingConfirmation = async (bookingData, pool) => {
  const { course_name, booking_ref, attendees, location, event_dates, payment, ip } = bookingData;
  
  const attendeeEmails = attendees.map(a => a.email).join(', ');
  const firstName = attendees[0]?.first_name || 'Customer';
  
  const mailOptions = {
    from: process.env.SMTP_USER,
    to: attendeeEmails,
    bcc: 'bookings@1stopinstruction.com',
    subject: `${course_name} Booking confirmation`,
    html: `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <title>1stopinstruction.com</title>
</head>
<body style="margin:0; padding:0;">
  <div align="center">
    <table width="800" border="0" align="center" style="background: #f5f5f5; border: 1px solid #e0e0e0; padding: 5px;">
      <tr>
        <td><img src="https://1stopinstruction.com/images/header-img.jpg" width="784" height="177" alt="1stopinstruction"/></td>
      </tr>
      <tr>
        <td style="background: #ffffff; padding: 10px;">
          <p style="font-size:9pt;font-family:Arial,sans-serif">
            <span style="float:right;"><strong>Booking Ref</strong>: ${booking_ref}</span>
          </p>
          <p style="font-size:9pt;font-family:Arial,sans-serif">Dear ${firstName},</p>
          <p style="font-size:9pt;font-family:Arial,sans-serif">Thank you for booking your ${course_name} with 1 Stop Instruction.</p>
          <p style="font-size:9pt;font-family:Arial,sans-serif">Please note your booking confirmation details below:</p>
          
          <table width="99%" style="font-size:9pt;font-family:Arial,sans-serif">
            <tr>
              <td width="15%"><strong>Name:</strong><br><strong>Course:</strong><br><strong>Payment:</strong></td>
              <td width="50%">${attendees.map(a => `${a.first_name} ${a.sur_name}`).join('<br>')}<br>${course_name}<br>£${payment.total_amount}</td>
              <td width="20%"><strong>Payment Received:</strong><br><strong>Balance Outstanding:</strong></td>
              <td width="15%" style="text-align:right">£${payment.paid}<br>£${payment.balance}</td>
            </tr>
          </table>
          
          <p style="font-size:9pt;font-family:Arial,sans-serif"><strong><u>Course Location</u></strong><br>
          ${location.name}<br>${location.address}</p>
          
          <p style="font-size:9pt;font-family:Arial,sans-serif"><strong><u>Date & Time</u></strong><br>
          ${event_dates.map(d => `${d.date} - ${d.start_time}`).join('<br>')}</p>
          
          <div style="font-size:9pt;font-family:Arial,sans-serif">
            <p>Please ensure that you carefully read your booking confirmation details, and in the unlikely event that any details are incorrect, please contact us at the earliest opportunity.</p>
            <p><strong>YOU MUST:</strong></p>
            <ul>
              <li>Arrive on time for the beginning of your course</li>
              <li>Bring your original UK photocard driving licence</li>
              <li>Bring appropriate clothing and equipment</li>
              <li>Read our <a href="https://www.1stopinstruction.com/termsandconditions.php">terms and conditions</a></li>
            </ul>
          </div>
          
          <p style="font-size:9pt;font-family:Arial,sans-serif">Kind Regards,<br><strong>1 Stop Instruction</strong></p>
          <p style="font-size:8pt;font-family:Arial,sans-serif;color:#666">Booking IP: ${ip}</p>
        </td>
      </tr>
      <tr>
        <td style="text-align:center;background:#e6e6e8;padding:10px;">
          <p style="font-size:10pt;font-family:Arial,sans-serif"><strong><i>"Roadcraft professionals for all categories of driving"</i></strong></p>
          <img src="https://1stopinstruction.com/images/footer-img.jpg" width="786" height="55" alt="1stopinstruction"/>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`
  };

  let emailStatus = 0;
  try {
    await transporter.sendMail(mailOptions);
    emailStatus = 1;
  } catch (error) {
    console.error('Error sending booking confirmation email:', error);
    emailStatus = 0;
  } finally {
    if (pool) {
      try {
        await pool.query(`
          INSERT INTO email_logs (\`to\`, cc, bcc, \`from\`, subject, email_content, status, type, book_ref, ip, created)
          VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, NOW())
        `, [
          attendeeEmails,
          'bookings@1stopinstruction.com',
          process.env.SMTP_USER,
          mailOptions.subject,
          mailOptions.html,
          emailStatus,
          'Booking Mail',
          booking_ref,
          ip || ''
        ]);
      } catch (logError) {
        console.error('Error logging email to database:', logError);
      }
    }
  }

  if (emailStatus === 0) {
    throw new Error('Failed to send booking confirmation email');
  }

  return { success: true, status: emailStatus };
};

exports.sendGiftVoucherEmail = async (voucherData, pool) => {
  const { voucher_ref, voucher_person, voucher_email, subject, voucher_value, voucher_free_text, purchased_by } = voucherData;

  const mailOptions = {
    from: process.env.SMTP_USER,
    to: voucher_email,
    bcc: 'bookings@1stopinstruction.com',
    subject: `1 Stop Instruction Gift Voucher - Ref: ${voucher_ref}`,
    html: `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <title>Gift Voucher - 1stopinstruction.com</title>
</head>
<body style="margin:0; padding:0;">
  <div align="center">
    <table width="800" border="0" align="center" style="background: #f5f5f5; border: 1px solid #e0e0e6; padding: 5px;">
      <tr>
        <td><img src="https://1stopinstruction.com/images/header-img.jpg" width="784" height="177" alt="1stopinstruction"/></td>
      </tr>
      <tr>
        <td style="background: #ffffff; padding: 20px;">
          <h2 style="color: #333; font-family: Arial, sans-serif;">Gift Voucher</h2>
          <p style="font-size:10pt;font-family:Arial,sans-serif">Dear ${voucher_person},</p>
          <p style="font-size:10pt;font-family:Arial,sans-serif">You have received a gift voucher from <strong>${purchased_by}</strong> for 1 Stop Instruction training.</p>
          
          <table width="100%" style="margin: 20px 0; border: 2px solid #333; padding: 15px; background: #f9f9f9;">
            <tr>
              <td style="font-size:11pt;font-family:Arial,sans-serif">
                <p><strong>Voucher Reference:</strong> ${voucher_ref}</p>
                <p><strong>Voucher Value:</strong> £${voucher_value}</p>
                <p><strong>Course:</strong> ${subject}</p>
                ${voucher_free_text ? `<p><strong>Message:</strong> ${voucher_free_text}</p>` : ''}
              </td>
            </tr>
          </table>
          
          <p style="font-size:10pt;font-family:Arial,sans-serif">To redeem this voucher, please contact us with your voucher reference number.</p>
          <p style="font-size:10pt;font-family:Arial,sans-serif">Contact: <a href="mailto:info@1stopinstruction.com">info@1stopinstruction.com</a></p>
          
          <p style="font-size:10pt;font-family:Arial,sans-serif; margin-top: 30px;">Kind Regards,<br><strong>1 Stop Instruction Team</strong></p>
        </td>
      </tr>
      <tr>
        <td style="text-align:center;background:#e6e6e8;padding:10px;">
          <p style="font-size:10pt;font-family:Arial,sans-serif"><strong><i>"Roadcraft professionals for all categories of driving"</i></strong></p>
          <img src="https://1stopinstruction.com/images/footer-img.jpg" width="786" height="55" alt="1stopinstruction"/>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`
  };

  let emailStatus = 0;
  try {
    await transporter.sendMail(mailOptions);
    emailStatus = 1;
  } catch (error) {
    console.error('Error sending gift voucher email:', error);
    emailStatus = 0;
  } finally {
    if (pool) {
      try {
        await pool.query(`
          INSERT INTO email_logs (\`to\`, cc, bcc, \`from\`, subject, email_content, status, type, book_ref, created)
          VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, NOW())
        `, [
          voucher_email,
          'bookings@1stopinstruction.com',
          process.env.SMTP_USER,
          mailOptions.subject,
          mailOptions.html,
          emailStatus,
          'Gift Voucher',
          voucher_ref
        ]);
      } catch (logError) {
        console.error('Error logging email to database:', logError);
      }
    }
  }

  return { success: emailStatus === 1, status: emailStatus };
};
