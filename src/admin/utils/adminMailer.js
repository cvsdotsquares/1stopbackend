const nodemailer = require('nodemailer');
const { getMailFrom, getReplyTo } = require('../../utils/mailFrom');

const smtpSecure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: smtpSecure,
  requireTLS: !smtpSecure && String(process.env.SMTP_REQUIRE_TLS ?? 'true').toLowerCase() !== 'false',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendAdminMail(mailOptions) {
  const from = getMailFrom();
  if (!from) {
    throw new Error('MAIL_FROM not configured');
  }

  return transporter.sendMail({
    from,
    ...(getReplyTo() ? { replyTo: getReplyTo() } : {}),
    ...mailOptions,
  });
}

module.exports = { sendAdminMail };
