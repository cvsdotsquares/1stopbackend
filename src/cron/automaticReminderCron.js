const cron = require('node-cron');
const { transporter, getMailFrom, getMailFromAddress, getReplyTo } = require('../utils/emailService');
const { replaceTokens } = require('../utils/tokenReplacer');
const { formatMySQLDateToDDMMYYYY } = require('../utils/dateFormat');

/**
 * Day-before course reminder email cron.
 * Mirrors legacy admin/cron/automatic_reminder_cron.php
 */
class AutomaticReminderCron {
  constructor(pool) {
    this.pool = pool;
    this.isRunning = false;
  }

  async sendReminders() {
    if (this.isRunning) {
      console.log('[REMINDER CRON] Previous execution still running, skipping...');
      return;
    }

    this.isRunning = true;
    try {
      console.log('[REMINDER CRON] Scanning for courses starting tomorrow...');

      const [bookings] = await this.pool.query(
        `SELECT
           b.id AS booking_id,
           b.course_id,
           b.course_event_id,
           b.type_of_book,
           ba.id AS attendee_id,
           ba.booking_ref,
           ba.first_name,
           ba.sur_name,
           ba.email,
           ba.vehicle_type,
           c.course_name,
           c.reminder_content,
           l.location_name,
           l.address1,
           l.address2,
           l.address3,
           l.address4,
           l.postcode,
           l.direction_map,
           l.direction_content,
           f.email_header,
           f.email_footer,
           f.email_logo,
           f.website,
           f.telephone,
           f.freephone,
           f.franchise_email,
           (
             SELECT MIN(ced.event_date)
             FROM course_event_dates ced
             WHERE ced.course_event_id = b.course_event_id
               AND ced.event_date != '0000-00-00'
           ) AS start_date
         FROM bookings b
         JOIN course_events ce ON ce.id = b.course_event_id
         JOIN franchise f ON f.id = ce.franchise_id
         LEFT JOIN locations l ON l.id = ce.location_id
         JOIN booking_attendees ba ON ba.booking_id = b.id
         JOIN courses c ON c.id = b.course_id
         WHERE b.status = 1
           AND IFNULL(b.on_hold, 0) = 0
           AND ba.autoreminder_email = 1
           AND ba.email IS NOT NULL
           AND TRIM(ba.email) != ''
         HAVING start_date = DATE_ADD(CURDATE(), INTERVAL 1 DAY)`
      );

      if (!bookings || bookings.length === 0) {
        console.log('[REMINDER CRON] No reminder emails needed for tomorrow');
        return;
      }

      console.log(`[REMINDER CRON] Found ${bookings.length} potential reminder candidate(s)`);

      const siteUrl = process.env.PHP_SITE_URL || process.env.SITE_URL || 'https://www.1stopinstruction.com/';
      const adminUrl = process.env.ADMIN_SITE_URL || `${siteUrl}admin/`;

      for (const bData of bookings) {
        const attendeeEmail = String(bData.email || '').trim();
        if (!attendeeEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(attendeeEmail)) {
          continue;
        }

        // 1. Check if course event is frozen
        const [freezeRows] = await this.pool.query(
          'SELECT COUNT(id) AS count_freeze FROM freeze WHERE course_event_id = ?',
          [bData.course_event_id]
        );
        if (Number(freezeRows?.[0]?.count_freeze || 0) > 0) {
          console.log(`[REMINDER CRON] Skipping booking #${bData.booking_id}: course event #${bData.course_event_id} is frozen`);
          continue;
        }

        // 2. Idempotency guard: prevent duplicate sends within last 24 hours
        const [existingLog] = await this.pool.query(
          `SELECT id FROM email_logs
           WHERE type = 'Booking Reminder'
             AND book_ref = ?
             AND created >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
           LIMIT 1`,
          [bData.booking_ref]
        );
        if (existingLog && existingLog.length > 0) {
          console.log(`[REMINDER CRON] Reminder already sent for booking ref ${bData.booking_ref} in last 24 hours, skipping`);
          continue;
        }

        // 3. Load all event dates for this course event
        const [eventDates] = await this.pool.query(
          `SELECT event_date, event_start_time, event_end_time
           FROM course_event_dates
           WHERE course_event_id = ? AND event_date != '0000-00-00'
           ORDER BY event_date ASC, event_start_time ASC`,
          [bData.course_event_id]
        );

        // 4. Vehicle type mapping
        const vehicleMap = {
          0: 'Manual',
          1: 'Automatic',
          3: 'I will be using my own vehicle',
        };
        const vehicleTypeLabel = vehicleMap[bData.vehicle_type] || 'N/A';

        // 5. Build dates table HTML
        let datesTableHtml = `
          <table width="100%" cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;border:1px solid #ddd;font-family:Arial,sans-serif;font-size:13px;">
            <thead>
              <tr style="background:#f2f2f2;">
                <th align="left">Date</th>
                <th align="left">Start Time</th>
                <th align="left">End Time</th>
              </tr>
            </thead>
            <tbody>`;
        for (const ed of eventDates) {
          datesTableHtml += `
            <tr>
              <td>${formatMySQLDateToDDMMYYYY(ed.event_date)}</td>
              <td>${ed.event_start_time || '—'}</td>
              <td>${ed.event_end_time || '—'}</td>
            </tr>`;
        }
        datesTableHtml += '</tbody></table>';

        // 6. Header and logo
        const headerImg = bData.email_header
          ? `${adminUrl}uploads/${bData.email_header}`
          : `${siteUrl}images/header-img.jpg`;

        // 7. Token replacement
        const pupilName = `${bData.first_name || ''} ${bData.sur_name || ''}`.trim();
        const randPrefix = Math.floor(Math.random() * 900) + 100;
        const encodedId = randPrefix + Buffer.from(String(bData.attendee_id)).toString('base64');

        let rawReminderContent = bData.reminder_content || '';
        try {
          rawReminderContent = await replaceTokens(this.pool, rawReminderContent);
        } catch (tokErr) {
          console.warn('[REMINDER CRON] Error in token replacement:', tokErr.message);
        }
        rawReminderContent = rawReminderContent.replace(/{id}/g, encodedId);

        // 8. Compose Email HTML
        const html = `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <title>${bData.course_name} Booking Reminder</title>
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;font-size:13px;line-height:1.5;color:#333;background:#f9f9f9;">
  <div align="center" style="padding:20px 0;">
    <table width="700" cellpadding="0" cellspacing="0" border="0" style="background:#fff;border:1px solid #e0e0e0;border-radius:4px;overflow:hidden;">
      <tr>
        <td>
          <img src="${headerImg}" width="700" alt="1 Stop Instruction" style="display:block;max-width:100%;height:auto;" />
        </td>
      </tr>
      <tr>
        <td style="padding:24px;">
          <p>Dear <strong>${pupilName || 'Student'}</strong>,</p>
          <p>This is a friendly reminder that your <strong>${bData.course_name}</strong> course is scheduled to start tomorrow.</p>

          <div style="margin:20px 0;padding:15px;background:#f8f9fa;border-left:4px solid #cc0000;">
            <p style="margin:0 0 8px 0;"><strong>Booking Reference:</strong> ${bData.booking_ref}</p>
            <p style="margin:0 0 8px 0;"><strong>Vehicle Transmission:</strong> ${vehicleTypeLabel}</p>
            <p style="margin:0;"><strong>Location:</strong> ${bData.location_name || '—'}<br />${[bData.address1, bData.address2, bData.address3, bData.postcode].filter(Boolean).join(', ')}</p>
          </div>

          <h3 style="color:#cc0000;margin-top:20px;">Course Dates &amp; Times</h3>
          ${datesTableHtml}

          ${rawReminderContent ? `<div style="margin-top:20px;">${rawReminderContent}</div>` : ''}

          <hr style="border:0;border-top:1px solid #eee;margin:25px 0;" />
          <p style="margin:0;font-size:12px;color:#777;">
            <strong>1 Stop Instruction</strong><br />
            Telephone: ${bData.telephone || '020 8597 7333'} | Freephone: ${bData.freephone || '0800 848 8418'}<br />
            Email: <a href="mailto:${bData.franchise_email || 'info@1stopinstruction.com'}">${bData.franchise_email || 'info@1stopinstruction.com'}</a> | Website: <a href="${bData.website || 'https://www.1stopinstruction.com'}">${bData.website || '1stopinstruction.com'}</a>
          </p>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`;

        const subject = `${bData.course_name} Booking Reminder`;
        const recipientEmail = (process.env.CRON_EMAILS_OVERRIDE_TO || attendeeEmail).trim();
        const mailOptions = {
          from: getMailFrom(),
          ...(getReplyTo() ? { replyTo: getReplyTo() } : {}),
          to: recipientEmail,
          subject,
          html,
        };

        let emailStatus = 0;
        try {
          await transporter.sendMail(mailOptions);
          emailStatus = 1;
          console.log(`[REMINDER CRON] Reminder sent to ${attendeeEmail} for booking ref ${bData.booking_ref}`);
        } catch (sendErr) {
          console.error(`[REMINDER CRON] Error sending reminder to ${attendeeEmail}:`, sendErr.message);
        } finally {
          try {
            await this.pool.query(
              `INSERT INTO email_logs (\`to\`, cc, bcc, \`from\`, subject, email_content, email_by, status, type, book_ref, created)
               VALUES (?, '', '', ?, ?, ?, 'a', ?, 'Booking Reminder', ?, NOW())`,
              [
                attendeeEmail,
                getMailFromAddress(),
                subject,
                html,
                emailStatus,
                bData.booking_ref || '',
              ]
            );
          } catch (logErr) {
            console.error('[REMINDER CRON] Error saving reminder email_log:', logErr.message);
          }
        }
      }
    } catch (error) {
      console.error('[REMINDER CRON] Error executing automaticReminderCron:', error);
    } finally {
      this.isRunning = false;
    }
  }

  start() {
    // Run daily at 08:00 AM
    cron.schedule('0 8 * * *', () => {
      this.sendReminders();
    });

    console.log('[REMINDER CRON] Scheduled to run daily at 08:00 AM');
  }
}

module.exports = AutomaticReminderCron;
