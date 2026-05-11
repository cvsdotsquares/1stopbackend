const nodemailer = require('nodemailer');
const { formatDateToDDMMYYYY, formatMySQLDateToDDMMYYYY } = require('./dateFormat');
const { replaceTokens } = require('./tokenReplacer');
const { getMailFrom, getMailFromAddress, getReplyTo } = require('./mailFrom');

// SMTP transport configuration:
//   - SMTP_SECURE=true (port 465) → implicit TLS from the first byte.
//   - SMTP_SECURE=false (port 587) → STARTTLS upgrade. We default
//     requireTLS=true so the connection MUST upgrade to TLS or fail; set
//     SMTP_REQUIRE_TLS=false to opt out for legacy servers without STARTTLS.
const smtpSecure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true';
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: smtpSecure,
  requireTLS: !smtpSecure && String(process.env.SMTP_REQUIRE_TLS ?? 'true').toLowerCase() !== 'false',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

exports.sendOTPEmail = async (email, firstName, otp) => {
  const mailOptions = {
    from: getMailFrom(),
    ...(getReplyTo() ? { replyTo: getReplyTo() } : {}),
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

exports.sendRegistrationEmail = async (userData, pool) => {
  const { email, first_name, sur_name } = userData;

  const mailOptions = {
    from: getMailFrom(),
    ...(getReplyTo() ? { replyTo: getReplyTo() } : {}),
    to: email,
    subject: 'Welcome to 1 Stop Instruction',
    html: `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <title>Welcome - 1stopinstruction.com</title>
</head>
<body style="margin:0; padding:0;">
  <div align="center">
    <table width="800" border="0" align="center" style="background: #f5f5f5; border: 1px solid #e0e0e0; padding: 5px;">
      <tr>
        <td><img src="${process.env.PHP_SITE_URL}/images/header-img.jpg" width="784" height="177" alt="1stopinstruction"/></td>
      </tr>
      <tr>
        <td style="background: #ffffff; padding: 20px;">
          <h2 style="color: #333; font-family: Arial, sans-serif;">Welcome to 1 Stop Instruction!</h2>
          <p style="font-size:10pt;font-family:Arial,sans-serif">Dear ${first_name} ${sur_name},</p>
          <p style="font-size:10pt;font-family:Arial,sans-serif">Thank you for registering with 1 Stop Instruction. Your account has been successfully created.</p>

          <div style="background: #f9f9f9; border-left: 4px solid #333; padding: 15px; margin: 20px 0;">
            <p style="font-size:10pt;font-family:Arial,sans-serif; margin: 0;"><strong>Your Account Details:</strong></p>
            <p style="font-size:10pt;font-family:Arial,sans-serif; margin: 10px 0 0 0;">Email: ${email}</p>
          </div>

          <p style="font-size:10pt;font-family:Arial,sans-serif">You can now:</p>
          <ul style="font-size:10pt;font-family:Arial,sans-serif">
            <li>Browse and book training courses</li>
            <li>Manage your bookings</li>
            <li>Update your profile information</li>
            <li>View your booking history</li>
          </ul>

          <p style="font-size:10pt;font-family:Arial,sans-serif">If you have any questions, please don't hesitate to contact us.</p>

          <p style="font-size:10pt;font-family:Arial,sans-serif; margin-top: 30px;">Kind Regards,<br><strong>1 Stop Instruction Team</strong></p>
        </td>
      </tr>
      <tr>
        <td style="text-align:center;background:#e6e6e8;padding:10px;">
          <p style="font-size:10pt;font-family:Arial,sans-serif"><strong><i>"Roadcraft professionals for all categories of driving"</i></strong></p>
          <img src="${process.env.PHP_SITE_URL}/images/footer-img.jpg" width="786" height="55" alt="1stopinstruction"/>
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
    console.error('Error sending registration email:', error);
    emailStatus = 0;
  } finally {
    if (pool) {
      try {
        await pool.query(`
          INSERT INTO email_logs (\`to\`, cc, bcc, \`from\`, subject, email_content, status, type, created)
          VALUES (?, '', '', ?, ?, ?, ?, ?, NOW())
        `, [
          email,
          getMailFromAddress(),
          mailOptions.subject,
          mailOptions.html,
          emailStatus,
          'Registration'
        ]);
      } catch (logError) {
        console.error('Error logging email to database:', logError);
      }
    }
  }

  return { success: emailStatus === 1, status: emailStatus };
};

exports.sendPasswordUpdateEmail = async (userData, pool) => {
  const { email, first_name, sur_name } = userData;

  const mailOptions = {
    from: getMailFrom(),
    ...(getReplyTo() ? { replyTo: getReplyTo() } : {}),
    to: email,
    subject: 'Password Updated - 1 Stop Instruction',
    html: `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <title>Password Updated - 1stopinstruction.com</title>
</head>
<body style="margin:0; padding:0;">
  <div align="center">
    <table width="800" border="0" align="center" style="background: #f5f5f5; border: 1px solid #e0e0e0; padding: 5px;">
      <tr>
        <td><img src="${process.env.PHP_SITE_URL}/images/header-img.jpg" width="784" height="177" alt="1stopinstruction"/></td>
      </tr>
      <tr>
        <td style="background: #ffffff; padding: 20px;">
          <h2 style="color: #333; font-family: Arial, sans-serif;">Password Successfully Updated</h2>
          <p style="font-size:10pt;font-family:Arial,sans-serif">Dear ${first_name} ${sur_name},</p>
          <p style="font-size:10pt;font-family:Arial,sans-serif">Your password has been successfully updated. You can now log in with your new password.</p>

          <div style="background: #f9f9f9; border-left: 4px solid #333; padding: 15px; margin: 20px 0;">
            <p style="font-size:10pt;font-family:Arial,sans-serif; margin: 0;"><strong>Your Account:</strong></p>
            <p style="font-size:10pt;font-family:Arial,sans-serif; margin: 10px 0 0 0;">Email: ${email}</p>
          </div>

          <p style="font-size:10pt;font-family:Arial,sans-serif">You can now access all features of your account:</p>
          <ul style="font-size:10pt;font-family:Arial,sans-serif">
            <li>Browse and book training courses</li>
            <li>Manage your bookings</li>
            <li>Update your profile information</li>
            <li>View your booking history</li>
          </ul>

          <p style="font-size:10pt;font-family:Arial,sans-serif">If you did not make this change, please contact us immediately.</p>

          <p style="font-size:10pt;font-family:Arial,sans-serif; margin-top: 30px;">Kind Regards,<br><strong>1 Stop Instruction Team</strong></p>
        </td>
      </tr>
      <tr>
        <td style="text-align:center;background:#e6e6e8;padding:10px;">
          <p style="font-size:10pt;font-family:Arial,sans-serif"><strong><i>"Roadcraft professionals for all categories of driving"</i></strong></p>
          <img src="${process.env.PHP_SITE_URL}/images/footer-img.jpg" width="786" height="55" alt="1stopinstruction"/>
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
    console.error('Error sending password update email:', error);
    emailStatus = 0;
  } finally {
    if (pool) {
      try {
        await pool.query(`
          INSERT INTO email_logs (\`to\`, cc, bcc, \`from\`, subject, email_content, status, type, created)
          VALUES (?, '', '', ?, ?, ?, ?, ?, NOW())
        `, [
          email,
          getMailFromAddress(),
          mailOptions.subject,
          mailOptions.html,
          emailStatus,
          'Password Update'
        ]);
      } catch (logError) {
        console.error('Error logging email to database:', logError);
      }
    }
  }

  return { success: emailStatus === 1, status: emailStatus };
};

const escapeHtml = (value) => String(value || '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const formatCurrency = (amount) => {
  const parsed = Number.parseFloat(amount || 0);
  return `£${Number.isFinite(parsed) ? parsed.toFixed(2) : '0.00'}`;
};

const formatTime12h = (timeString) => {
  if (!timeString) return 'TBC';
  const parts = String(timeString).split(':');
  if (parts.length < 2) return 'TBC';
  const hours = Number.parseInt(parts[0], 10);
  const minutes = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 'TBC';
  const suffix = hours >= 12 ? 'pm' : 'am';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, '0')} ${suffix}`;
};

const minusMinutes = (timeString, minutesToMinus = 15) => {
  if (!timeString) return null;
  const parts = String(timeString).split(':');
  if (parts.length < 2) return null;
  const hours = Number.parseInt(parts[0], 10);
  const minutes = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  let totalMinutes = (hours * 60 + minutes) - minutesToMinus;
  while (totalMinutes < 0) totalMinutes += 24 * 60;
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
};

const normalizeUrl = (url, fallback) => {
  const value = String(url || '').trim();
  if (!value) return fallback;
  if (/^https?:\/\//i.test(value)) {
   return value.replace(/^http:\/\//i, 'https://').replace('http://https://', 'https://');
  }
  return `https://${value}`;
};

const isTbcDate = (dateValue) => {
  const raw = String(dateValue || '').trim();
  return (
    // Return true if the date is empty, null, undefined or before 1900
    $date = new Date(raw),
    isNaN($date.getTime()) || $date.getFullYear() < 1900
  );
};

exports.sendBookingConfirmation = async (bookingData, pool) => {
  const {
   course_name,
   booking_ref,
   booking_type = 'O',
  bookingRefSuffix = '',
   refundable = 0,
   attendees = [],
    targetEmails = [],
    previewOnly = false,
  disableBcc = false,
   location = {},
   event_dates = [],
   booking = {},
   course_email_content = '',
   franchise = {},
   bcc,
   ip,
    logType,
    emailBy
  } = bookingData;

  const normalizedTargetEmails = Array.isArray(targetEmails)
    ? targetEmails.map((email) => String(email || '').trim()).filter(Boolean)
    : [];

  const attendeeEmailList = Array.from(new Set(
    (normalizedTargetEmails.length > 0
      ? normalizedTargetEmails
      : attendees.map(a => String(a?.email || '').trim()))
      .filter(Boolean)
  ));
  if (attendeeEmailList.length === 0) {
    throw new Error('No attendee email found for booking confirmation');
  }
  const vehicleTypeMap = {
   0: 'Manual',
   1: 'Automatic',
   3: 'I will be using my own vehicle'
  };

  const getAttendeeForRecipient = (recipientEmail) => {
    const normalizedRecipient = String(recipientEmail || '').trim().toLowerCase();
    const exactMatch = attendees.find((attendee) =>
      String(attendee?.email || '').trim().toLowerCase() === normalizedRecipient
    );

    return exactMatch || attendees[0] || {};
  };

  const paidAmount = (Number.parseFloat(booking.total_amount || 0) - Number.parseFloat(booking.payment_due || 0));
  const balanceAmount = Number.parseFloat(booking.payment_due || 0);

  const normalizedSiteUrl = normalizeUrl(process.env.PHP_SITE_URL, 'https://1stopinstruction.com/');
  const siteUrl = normalizedSiteUrl.endsWith('/') ? normalizedSiteUrl : `${normalizedSiteUrl}/`;
  const headerPath = franchise.email_header
   ? `${siteUrl}admin/uploads/${franchise.email_header}`
   : `${siteUrl}images/header-img.jpg`;
  const footerPath = franchise.email_footer
   ? `${siteUrl}admin/uploads/${franchise.email_footer}`
   : `${siteUrl}images/footer-img.jpg`;
  const logoPath = franchise.email_logo
   ? `${siteUrl}admin/uploads/${franchise.email_logo}`
   : `${siteUrl}images/logo.png`;
  const logoWebPath = normalizeUrl(franchise.website, siteUrl);

  // Process course_email_content to replace tokens
  let processedCourseEmailContent = course_email_content;
  if (pool) {
    try {
      processedCourseEmailContent = await replaceTokens(pool, course_email_content);
    } catch (error) {
      console.error('Error replacing tokens in course_email_content:', error);
      processedCourseEmailContent = course_email_content;
    }
  }

  // process the location.direction_content to replace tokens as well, since it may contain image src that needs normalization
  let processedLocationDirectionContent = location.direction_content;
  if (pool) {
    try {
      processedLocationDirectionContent = await replaceTokens(pool, location.direction_content);
    } catch (error) {
      console.error('Error replacing tokens in location.direction_content:', error);
      processedLocationDirectionContent = location.direction_content;
    }
  }
  const hasTbc = event_dates.some(d => isTbcDate(d.event_date));
  const dateRows = event_dates
    .filter(d => !isTbcDate(d.event_date))
    .sort((a, b) => {
      const dateA = new Date(a.event_date);
      const dateB = new Date(b.event_date);
      const tsA = Number.isNaN(dateA.getTime()) ? Number.MAX_SAFE_INTEGER : dateA.getTime();
      const tsB = Number.isNaN(dateB.getTime()) ? Number.MAX_SAFE_INTEGER : dateB.getTime();
      return tsA - tsB;
    })
   .map((d) => {
    const start = formatTime12h(d.event_start_time);
    const meetingTimeRaw = minusMinutes(d.event_start_time, 15);
    const meeting = formatTime12h(meetingTimeRaw);
    return `
    <tr>
      <td>${escapeHtml(formatMySQLDateToDDMMYYYY(d.event_date))}</td>
      <td><span class="aQJ">${escapeHtml(meeting)}</span></td>
      <td><span class="aQJ">${escapeHtml(start)}</span></td>
    </tr>`;
   }).join('');

  const directionMapImage = location.direction_map
   ? `${siteUrl}maps/${location.direction_map}`
   : `${siteUrl}images/no-map.jpg`;

  const resolvedBcc = disableBcc
    ? undefined
    : (String(bcc || process.env.BOOKING_BCC || '').trim() || undefined);

  const bookingTypeLabel = `${String(booking_type).charAt(0).toUpperCase()}${String(bookingRefSuffix || '').trim().toUpperCase()}`;

  const createBookingEmailHtml = (recipientAttendee) => {
   const recipientFirstName = recipientAttendee.first_name || 'Customer';
   const recipientPupil = `${recipientAttendee.first_name || ''} ${recipientAttendee.sur_name || ''}`.trim();
   const recipientVehicle = vehicleTypeMap[recipientAttendee.vehicle_type] || '';

   return `<!Doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" />
    <title>1stopinstruction.com</title>
  </head>
  <body style="margin:0; padding:0;">
    <div align="center">
      <table width="800" border="0" align="center" style="background: #f5f5f5 none repeat scroll 0 0; border: 1px solid #e0e0e0; padding: 5px;">
        <tbody>
          <tr>
            <td class="header">
              <img src="${escapeHtml(headerPath)}" width="784" height="177" alt="1stopinstruction" style="display:block;border:0;outline:none;text-decoration:none;"/>
            </td>
          </tr>
          <tr>
            <td class="content">
              <table width="100%" border="0" style="background: #ffffff none repeat scroll 0 0;padding: 10px; margin:0;">
                <tbody>
                  <tr>
                    <td style="font-size:9.0pt;font-family:Arial,sans-serif">
                      <span style="float:right;">
                      <strong>Booking Ref</strong>: ${escapeHtml(booking_ref)} - ${escapeHtml(bookingTypeLabel)}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td style="font-size:9.0pt;font-family:Arial,sans-serif">
                      <span style=" float:left;">
                      Dear ${escapeHtml(recipientFirstName)},
                      </span>
                      ${Number(refundable) === 1
      ? '<br><br><p style="color:red"><strong><i class="icon fa fa-ban"></i> You have taken longer than expected to make payment & complete your booking, so your reserved places have not been booked. Please contact to the website administrator to arrange a refund.<strong></p>'
      : ''}
                    </td>
                  </tr>
                  <tr>
                    <td style="font-size:9.0pt;font-family:Arial,sans-serif">
                      <p>Thank you for booking your ${escapeHtml(course_name)} Course with 1 Stop Instruction.</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="font-size:9.0pt;font-family:Arial,sans-serif">
                      <p style="margin-top:0px">Please note your booking confirmation details below:</p>
                      <table cellspacing="0" cellpadding="0" border="0" width="99%" style="width:99.0%">
                        <tbody>
                          <tr style="height:48.75pt">
                            <td width="9%" style="width:9.0%;padding:0in 0in 0in 0in;height:48.75pt">
                              <p class="MsoNormal"><span><b><span style="font-size:9.0pt;font-family:Arial,sans-serif;color:black">Name:</span></b></span><b><span style="font-size:9.0pt;font-family:Arial,sans-serif;color:black"><br>
                                <span>Course:</span><br>
                                <span>Vehicle:</span></span></b><span style="font-size:9.5pt;font-family:Arial,sans-serif"><u></u><u></u></span>
                              </p>
                            </td>
                            <td width="56%" style="width:56.0%;padding:0in 0in 0in 0in;height:48.75pt">
                              <p class="MsoNormal"><span><span style="font-size:9.0pt;font-family:Arial,sans-serif">${escapeHtml(recipientPupil)}</span></span><span style="font-size:9.0pt;font-family:Arial,sans-serif"><br>
                                <span>${escapeHtml(course_name)}</span><br>
                                <span>${escapeHtml(recipientVehicle)} </span></span>
                              </p>
                            </td>
                            <td width="20%" style="width:20.0%;padding:0in 0in 0in 0in;height:48.75pt">
                              <p class="MsoNormal"><strong><span style="font-size:9.0pt;font-family:Arial,sans-serif;color:black">Payment Received:</span></strong><span style="font-size:9.0pt;font-family:Arial,sans-serif;color:black"><br>
                                <strong><span style="font-family:Arial,sans-serif">Balance Outstanding: </span></strong><u></u><u></u></span>
                              </p>
                            </td>
                            <td width="12%" style="text-align: right;width:12.0%;padding:0in 0in 0in 0in;height:48.75pt">
                              <p class="MsoNormal"><span style="color: black;">${formatCurrency(paidAmount)}<br>
                                ${formatCurrency(balanceAmount)}</span>
                              </p>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="font-size:9.0pt;font-family:Arial,sans-serif">
                      <table width="100%" border="0" cellspacing="0" cellpadding="0">
                        <tr>
                          <td width="60%">
                            <table width="100%" border="0" cellspacing="0" cellpadding="0">
                              <tr>
                                <td><strong><u>Course Location</u></strong></td>
                              </tr>
                              <tr>
                                <td>
                                  <div class="">${location.location_name ? `${escapeHtml(location.location_name)}<br>` : ''}</div>
                                  <div class="">${location.address1 ? `${escapeHtml(location.address1)}<br>` : ''}</div>
                                  <div class="">${location.address2 ? `${escapeHtml(location.address2)}<br>` : ''}</div>
                                  <div class="">${location.address3 ? `${escapeHtml(location.address3)}<br>` : ''}</div>
                                  <div class="">${location.address4 ? `${escapeHtml(location.address4)}<br>` : ''}</div>
                                  <div class="">${escapeHtml(location.postcode || '')}</div>
                                </td>
                              </tr>
                            </table>
                          </td>
                          <td align="right" valign="top">
                            <table width="98%" border="0" cellspacing="0" cellpadding="0">
                              <tr>
                                <td width="24%"><strong><u>Date</u></strong></td>
                                <td width="36%"><strong><u>Meeting Time</u></strong></td>
                                <td width="33%"><strong><u>Start Time</u></strong></td>
                              </tr>
                              ${dateRows}
                              ${hasTbc
      ? `<tr>
                                <td>TBC</td>
                                <td>TBC</td>
                                <td>TBC</td>
                              </tr>
                              <tr>
                                <td colspan="3"> </td>
                              </tr>
                              <tr>
                                <td colspan="3"><i>TBC = To be confirmed once Module 1 Test is passed</i></td>
                              </tr>`
      : ''}
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td> </td>
                  </tr>
                  <tr>
                    <td style="font-size:9.0pt;font-family:Arial,sans-serif">
                      ${processedCourseEmailContent || ''}
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="font-family: arial; font-size: 12px;" >
                        <tr>
                          <td width="50%" height="20" valign="top"><b>Directions</b></td>
                          <td width="50%" rowspan="2" align="center" valign="top"><b>Map of Location</b><br>
                          </td>
                        </tr>
                        <tr>
                          <td colspan="2"  valign="top" style="text-align:left;"><img src="${escapeHtml(directionMapImage)}" width="350" style="display:block;border:0;outline:none;text-decoration:none;float:right; margin:10px 0 10px 10px;" alt="Direction Map"/>${processedLocationDirectionContent || ''} </td>
                        </tr>
                        <tr>
                          <td colspan="2">Finally, we trust that all the information you require is listed in this email, and we hope that you enjoy your course, but should you have any questions in the meantime, please do not hesitate to contact us.</td>
                        </tr>
                        <tr>
                          <td style="color:#ff6600"> </td>
                          <td> </td>
                        </tr>
                        <tr>
                          <td style="color:black;">Kind Regards,</td>
                          <td> </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <table width="100%" border="0">
                        <tbody>
                          <tr>
                            <td>
                              <p class="MsoNormal" style="margin: 10px 0px; font-family: arial;"><span><b><i><span style="font-size:13.5pt">1 Stop Instruction</span></i></b></span><span style="font-size:9.5pt;font-family:Arial,sans-serif"><u></u><u></u></span></p>
                            </td>
                          </tr>
                          <tr>
                            <td>
                              <table cellspacing="0" cellpadding="0" border="0" width="99%" style="width:99.0%">
                                <tbody>
                                  <tr>
                                    <td align="left" valign="middle">
                                      <a href="${escapeHtml(logoWebPath)}"><img src="${escapeHtml(logoPath)}" width="90"  alt="1stopinstruction" style="display:block;border:0;outline:none;text-decoration:none;" /></a>
                                    </td>
                                    <td width="45%" valign="top" style="width:45.0%;padding:0in 0in 0in 0in">
                                      <p class="MsoNormal"><strong><span style="font-size:9.0pt;font-family:Arial,sans-serif;color:navy">Contact:</span></strong><span style="font-size:9.0pt;font-family:Arial,sans-serif;color:#09016e"><br>
                                        </span><span><span style="font-size:9.0pt;color:navy; font-family:Arial,sans-serif">Tel: <a target="_blank" href="tel:${escapeHtml(franchise.telephone || '')}">${escapeHtml(franchise.telephone || '')}</a></span></span><span style="line-height: 20px; font-size:9.0pt;font-family:Arial,sans-serif;color:navy"><br>
                                        <span>Freephone: <a target="_blank" href="tel:${escapeHtml(franchise.freephone || '')}">${escapeHtml(franchise.freephone || '')}</a></span><br>
                                        <span>Email: <a target="_blank" href="mailto:${escapeHtml(franchise.franchise_email || '')}">${escapeHtml(franchise.franchise_email || '')}</a> </span><br>
                                        <span>Web: <a target="_blank" href="${escapeHtml(normalizeUrl(franchise.website, siteUrl))}">${escapeHtml(franchise.website || '')}</a></span></span><span style="font-size:9.5pt;font-family:Arial,sans-serif"><u></u><u></u></span>
                                      </p>
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
          <tr>
            <td class="footer">
              <p align="center" style="text-align:center;background:#e6e6e8" class="MsoNormal"><span><b><i><span style="font-size:10.0pt;font-family:Arial,sans-serif">"Roadcraft professionals for all categories of driving"</span></i></b></span><b><span style="font-size:9.5pt;font-family:Arial, sans-serif"><u></u><u></u></span></b></p>
              <p style="font-family: Arial, sans-serif; text-align:center; font-size:9.5pt;">Please visit our website for <a href="${escapeHtml(`${siteUrl}contactus.php`)}">directions</a> and our <a href="${escapeHtml(`${siteUrl}termsandconditions.php`)}">terms &amp; conditions </a></p>
              <p style="margin-bottom:0;">
                <img src="${escapeHtml(footerPath)}" width="786" height="55" alt="1stopinstruction" style="display:block;border:0;outline:none;text-decoration:none;"/>
              </p>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div style="display:none">Booking IP: ${escapeHtml(ip || '')}</div>
  </body>
</html>`;
  };

  const mailOptions = {
   from: getMailFrom(),
   ...(getReplyTo() ? { replyTo: getReplyTo() } : {}),
   to: attendeeEmailList[0],
   bcc: resolvedBcc,
   subject: `${course_name} Booking confirmation`
  };

  if (previewOnly) {
    const previews = attendeeEmailList.map((recipientEmail) => {
      const recipientAttendee = getAttendeeForRecipient(recipientEmail);
      return {
        to: recipientEmail,
        html: createBookingEmailHtml(recipientAttendee)
      };
    });

    return {
      success: true,
      status: 1,
      subject: mailOptions.subject,
      previews
    };
  }

  let emailStatus = 0;
  let deliveryMeta = [];
  const failedRecipients = [];
  const deliveryMetaByRecipient = new Map();
  const emailHtmlByRecipient = new Map();
  try {
    for (const recipientEmail of attendeeEmailList) {
      const recipientAttendee = getAttendeeForRecipient(recipientEmail);
      const recipientEmailHtml = createBookingEmailHtml(recipientAttendee);
      emailHtmlByRecipient.set(recipientEmail, recipientEmailHtml);

      try {
        const sentInfo = await transporter.sendMail({
          ...mailOptions,
          to: recipientEmail,
          html: recipientEmailHtml
        });

        const recipientDeliveryMeta = {
          to: recipientEmail,
          messageId: sentInfo?.messageId || null,
          accepted: sentInfo?.accepted || [],
          rejected: sentInfo?.rejected || [],
          response: sentInfo?.response || null
        };

        deliveryMeta.push(recipientDeliveryMeta);
        deliveryMetaByRecipient.set(recipientEmail, recipientDeliveryMeta);
      } catch (recipientError) {
        failedRecipients.push(recipientEmail);
        const recipientErrorMeta = {
          to: recipientEmail,
          error: recipientError?.message || 'Unknown email send error'
        };
        deliveryMeta.push(recipientErrorMeta);
        deliveryMetaByRecipient.set(recipientEmail, recipientErrorMeta);
        console.error(`Error sending booking confirmation email to ${recipientEmail}:`, recipientError);
      }
    }

    emailStatus = failedRecipients.length === 0 ? 1 : 0;
  } catch (error) {
    console.error('Error sending booking confirmation email:', error);
    if (error?.response) {
      console.error('SMTP response:', error.response);
    }
    if (error?.rejected) {
      console.error('SMTP rejected recipients:', error.rejected);
    }
    emailStatus = 0;
  } finally {
    if (pool) {
      for (const recipientEmail of attendeeEmailList) {
        const recipientMeta = deliveryMetaByRecipient.get(recipientEmail) || {
          to: recipientEmail,
          error: 'No delivery metadata captured'
        };
        const recipientStatus = failedRecipients.includes(recipientEmail) ? 0 : 1;

        try {
          const recipientEmailHtml = emailHtmlByRecipient.get(recipientEmail)
            || createBookingEmailHtml(getAttendeeForRecipient(recipientEmail));

          await pool.query(`
            INSERT INTO email_logs (\`to\`, cc, bcc, \`from\`, subject, email_content, email_by, status, type, book_ref, ip, created)
            VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
          `, [
            recipientEmail,
            resolvedBcc || '',
            getMailFromAddress(),
            mailOptions.subject,
            `${recipientEmailHtml}\n\n<!-- delivery_meta: ${escapeHtml(JSON.stringify(recipientMeta || {}))} -->`,
            emailBy || 0,
            recipientStatus,
            logType || 'Booking Mail',
            booking_ref,
            ip || ''
          ]);
        } catch (logError) {
          console.error(`Error logging email to database for ${recipientEmail}:`, logError);
        }
      }
    }
  }

  if (emailStatus === 0) {
    if (failedRecipients.length > 0) {
      throw new Error(`Failed to send booking confirmation email to: ${failedRecipients.join(', ')}`);
    }
    throw new Error('Failed to send booking confirmation email');
  }

  return { success: true, status: emailStatus };
};

exports.sendGiftVoucherEmail = async (voucherData, pool) => {
  const {
    voucher_ref,
    voucher_person,
    voucher_email,
    subject,
    voucher_value,
    voucher_free_text,
    created,
    targetEmail,
    previewOnly = false
  } = voucherData;

  const resolvedRecipientEmail = String(targetEmail || voucher_email || '').trim();
  if (!resolvedRecipientEmail) {
    throw new Error('No recipient email found for gift voucher email');
  }

  const normalizedVoucherSubject = String(subject || voucherData?.course_name || '').trim();
  const voucherSubjectLabel = normalizedVoucherSubject || 'Motorcycle Training, CBT, Driving Lessons';

  // Format the issue date (DD/MM/YYYY)
  const issueDate = created ? formatDateToDDMMYYYY(created) : formatDateToDDMMYYYY(new Date());
  const baseIssueDate = created ? new Date(created) : new Date();
  const expiryDateObject = new Date(baseIssueDate);
  expiryDateObject.setFullYear(expiryDateObject.getFullYear() + 1);
  const expiryDate = formatDateToDDMMYYYY(expiryDateObject);

  // Get voucher terms from database
  let voucherTerms = '';
  if (pool) {
    try {
      const [templates] = await pool.query('SELECT details FROM voucher_templates WHERE id = 1 LIMIT 1');
      if (templates.length > 0 && templates[0].details) {
        voucherTerms = templates[0].details;
      }
    } catch (error) {
      console.error('Error fetching voucher terms:', error);
    }
  }

  const createGiftVoucherEmailHtml = () => `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <title>Gift Voucher - 1stopinstruction.com</title>
</head>
<body style="margin:0; padding:0;">
  <div align="center">
    <table width="800" border="0" align="center" style="background: #f5f5f5; border: 1px solid #e0e0e6; padding: 5px;">
      <tr>
        <td><img src="${process.env.PHP_SITE_URL}/images/header-img.jpg" width="784" height="177" alt="1stopinstruction"/></td>
      </tr>
      <tr>
        <td style="background: #ffffff; padding: 20px;">
          <table width="100%" border="0">
            <tr>
              <td>
                <h2 style="color: #333; font-family: Arial, sans-serif; margin: 0;">Gift Voucher For ${escapeHtml(voucherSubjectLabel)}</h2>
              </td>
              <td align="right" valign="top">
                <p style="font-size:10pt;font-family:Arial,sans-serif; margin: 0;">
                  <strong>Issue Date:</strong> <span style="color: #333;">${issueDate}</span><br>
                  <strong><span style="color: #333;">Expiry Date:</span></strong> <span style="color: #FF0000;">${expiryDate}</span>
                </p>
              </td>
            </tr>
          </table>

          <table width="100%" style="margin: 20px 0; border: 2px solid #333; padding: 15px; background: #f9f9f9;">
            <tr>
              <td style="font-size:11pt;font-family:Arial,sans-serif">
                <p style="margin: 5px 0;"><strong>This Voucher belongs to ${voucher_person}</strong></p>
                <p style="margin: 5px 0;"><strong>Voucher Reference:</strong> ${voucher_ref}</p>
                <p style="margin: 5px 0;"><strong>Voucher Value:</strong> £${voucher_value}</p>
                ${voucher_free_text ? `<p style="margin: 5px 0;"><strong>Message:</strong> ${voucher_free_text}</p>` : ''}
              </td>
            </tr>
          </table>

          <p style="font-size:10pt;font-family:Arial,sans-serif">To redeem this voucher, please contact us on <a href="tel:02085977333"><strong>020 8597 7333</strong></a> and provide your voucher reference number.</p>

          ${voucherTerms ? `
          <div style="margin: 20px 0; padding: 15px; background: #f9f9f9; border-left: 4px solid #333;">
            <p style="font-size:10pt;font-family:Arial,sans-serif; margin: 0 0 10px 0;"><strong>Terms and Conditions</strong></p>
            <div style="font-size:9pt;font-family:Arial,sans-serif; color: #555;">${voucherTerms}</div>
          </div>
          ` : ''}

          <p style="font-size:10pt;font-family:Arial,sans-serif; margin-top: 30px;">Kind Regards,<br><strong>1 Stop Instruction Team</strong></p>
        </td>
      </tr>
      <tr>
        <td style="text-align:center;background:#e6e6e8;padding:10px;">
          <p style="font-size:10pt;font-family:Arial,sans-serif"><strong><i>"Roadcraft professionals for all categories of driving"</i></strong></p>
          <img src="${process.env.PHP_SITE_URL}/images/footer-img.jpg" width="786" height="55" alt="1stopinstruction"/>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`;

  const mailOptions = {
    from: getMailFrom(),
    ...(getReplyTo() ? { replyTo: getReplyTo() } : {}),
    to: resolvedRecipientEmail,
    bcc: process.env.BOOKING_BCC,
    subject: `1 Stop Instruction Gift Voucher - Ref: ${voucher_ref}`,
    html: createGiftVoucherEmailHtml()
  };

  if (previewOnly) {
    return {
      success: true,
      status: 1,
      subject: mailOptions.subject,
      to: resolvedRecipientEmail,
      html: mailOptions.html
    };
  }

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
          resolvedRecipientEmail,
          'bookings.testds@yopmail.com',
          getMailFromAddress(),
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
