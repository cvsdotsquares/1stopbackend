const cron = require('node-cron');
const { transporter, getMailFrom, getMailFromAddress, getReplyTo } = require('../utils/emailService');
const { replaceTokens } = require('../utils/tokenReplacer');

/**
 * Course-linked automated follow-up emails cron.
 * Mirrors legacy admin/cron/automated_email_cron.php
 */
class AutomatedEmailCron {
  constructor(pool) {
    this.pool = pool;
    this.isRunning = false;
  }

  calculateTargetDate(rule) {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');

    if (Number(rule.year) > 0) {
      d.setFullYear(d.getFullYear() - Number(rule.year));
    } else if (Number(rule.month) > 0) {
      d.setMonth(d.getMonth() - Number(rule.month));
    } else if (Number(rule.day) > 0) {
      d.setDate(d.getDate() - Number(rule.day));
    } else {
      return null;
    }

    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  async processAutomatedEmails() {
    if (this.isRunning) {
      console.log('[AUTOMATED EMAIL CRON] Previous execution still running, skipping...');
      return;
    }

    this.isRunning = true;
    try {
      console.log('[AUTOMATED EMAIL CRON] Scanning active automated email rules...');

      const [activeRules] = await this.pool.query(
        `SELECT id, course_id, subject, automated_email_content, day, month, year
         FROM automated_emails
         WHERE status = 1`
      );

      if (!activeRules || activeRules.length === 0) {
        console.log('[AUTOMATED EMAIL CRON] No active automated email rules found');
        return;
      }

      const siteUrl = process.env.PHP_SITE_URL || process.env.SITE_URL || 'https://www.1stopinstruction.com/';

      for (const rule of activeRules) {
        const targetDate = this.calculateTargetDate(rule);
        if (!targetDate) {
          continue;
        }

        const courseId = Number(rule.course_id);
        if (!courseId || courseId <= 0) {
          continue;
        }

        const [passedAttendees] = await this.pool.query(
          `SELECT
             ba.id AS attendee_id,
             ba.booking_ref,
             ba.first_name,
             ba.sur_name,
             ba.email,
             sdr.report_day
           FROM student_daily_report sdr
           JOIN bookings b ON b.id = sdr.booking_id
           JOIN booking_attendees ba ON ba.booking_id = b.id
           WHERE b.status = 1
             AND IFNULL(b.on_hold, 0) = 0
             AND sdr.report = 1
             AND ba.autoreminder_email = 1
             AND b.course_id = ?
             AND DATE(sdr.report_day) = ?
             AND ba.email IS NOT NULL
             AND TRIM(ba.email) != ''`,
          [courseId, targetDate]
        );

        if (!passedAttendees || passedAttendees.length === 0) {
          continue;
        }

        console.log(
          `[AUTOMATED EMAIL CRON] Rule #${rule.id} ("${rule.subject}") matched ${passedAttendees.length} student(s) from ${targetDate}`
        );

        let sentForThisRule = false;

        for (const student of passedAttendees) {
          const email = String(student.email || '').trim();
          if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            continue;
          }

          // Idempotency guard: prevent duplicate sends today
          const [alreadySent] = await this.pool.query(
            `SELECT id FROM email_logs
             WHERE type = 'Automated Email'
               AND book_ref = ?
               AND subject = ?
               AND DATE(created) = CURDATE()
             LIMIT 1`,
            [student.booking_ref, rule.subject]
          );

          if (alreadySent && alreadySent.length > 0) {
            continue;
          }

          // Obfuscate / encode attendee id
          const randPrefix = Math.floor(Math.random() * 900) + 100;
          const encodedId = randPrefix + Buffer.from(String(student.attendee_id)).toString('base64');

          let rawContent = rule.automated_email_content || '';
          try {
            rawContent = await replaceTokens(this.pool, rawContent);
          } catch (tErr) {
            console.warn('[AUTOMATED EMAIL CRON] Token replace warning:', tErr.message);
          }
          rawContent = rawContent.replace(/{id}/g, encodedId);

          const pupilName = `${student.first_name || ''} ${student.sur_name || ''}`.trim();
          const html = `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <title>${rule.subject}</title>
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;font-size:13px;line-height:1.5;color:#333;background:#f9f9f9;">
  <div align="center" style="padding:20px 0;">
    <table width="700" cellpadding="0" cellspacing="0" border="0" style="background:#fff;border:1px solid #e0e0e0;border-radius:4px;overflow:hidden;">
      <tr>
        <td>
          <img src="${siteUrl}images/header-img.jpg" width="700" alt="1 Stop Instruction" style="display:block;max-width:100%;height:auto;" />
        </td>
      </tr>
      <tr>
        <td style="padding:24px;">
          <p>Dear <strong>${pupilName || 'Student'}</strong>,</p>
          <div style="margin:15px 0;">
            ${rawContent}
          </div>
          <hr style="border:0;border-top:1px solid #eee;margin:25px 0;" />
          <p style="margin:0;font-size:12px;color:#777;">
            <strong>1 Stop Instruction</strong><br />
            Telephone: 020 8597 7333 | Freephone: 0800 848 8418<br />
            Email: <a href="mailto:info@1stopinstruction.com">info@1stopinstruction.com</a> | Website: <a href="https://www.1stopinstruction.com">1stopinstruction.com</a>
          </p>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`;

          const recipientEmail = (process.env.CRON_EMAILS_OVERRIDE_TO || email).trim();
          const mailOptions = {
            from: getMailFrom(),
            ...(getReplyTo() ? { replyTo: getReplyTo() } : {}),
            to: recipientEmail,
            subject: rule.subject,
            html,
          };

          let emailStatus = 0;
          try {
            await transporter.sendMail(mailOptions);
            emailStatus = 1;
            sentForThisRule = true;
            console.log(`[AUTOMATED EMAIL CRON] Sent "${rule.subject}" to ${email} (ref: ${student.booking_ref})`);
          } catch (sendErr) {
            console.error(`[AUTOMATED EMAIL CRON] Error sending to ${email}:`, sendErr.message);
          } finally {
            try {
              await this.pool.query(
                `INSERT INTO email_logs (\`to\`, cc, bcc, \`from\`, subject, email_content, email_by, status, type, book_ref, created)
                 VALUES (?, '', '', ?, ?, ?, 'a', ?, 'Automated Email', ?, NOW())`,
                [
                  email,
                  getMailFromAddress(),
                  rule.subject,
                  html,
                  emailStatus,
                  student.booking_ref || '',
                ]
              );
            } catch (logErr) {
              console.error('[AUTOMATED EMAIL CRON] Error saving email_log:', logErr.message);
            }
          }
        }

        if (sentForThisRule) {
          await this.pool.query(
            'UPDATE automated_emails SET last_sent = NOW() WHERE id = ?',
            [rule.id]
          );
        }
      }
    } catch (error) {
      console.error('[AUTOMATED EMAIL CRON] Error in processAutomatedEmails:', error);
    } finally {
      this.isRunning = false;
    }
  }

  start() {
    // Run daily at 07:00 AM
    cron.schedule('0 7 * * *', () => {
      this.processAutomatedEmails();
    });

    console.log('[AUTOMATED EMAIL CRON] Scheduled to run daily at 07:00 AM');
  }
}

module.exports = AutomatedEmailCron;
