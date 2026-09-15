// src/utils/mailFrom.js
//
// Builds the visible "From" identity for outgoing email.
//
// The legacy PHP site uses PHPMailer's pattern:
//   $mail->setFrom("info@example.com", "Display Name");   // visible sender
//   $mail->Username = "service-token";                    // SMTP auth identity
//   $mail->Password = "...";
// i.e. the SMTP auth username is NOT the same as the From address. Many
// transactional providers (Mailgun, SendGrid, SMTP2GO, etc.) require this:
// auth with a token, send From a real human-friendly address.
//
// Earlier versions of this codebase used `process.env.SMTP_USER` for both
// auth AND the From header, which breaks the moment SMTP_USER is a token
// instead of an email. These helpers decouple the two.
//
// Resolution order for the visible From email:
//   1. MAIL_FROM_EMAIL    (preferred, dedicated)
//   2. CONTACT_FROM       (legacy, still honoured for back-compat)
//   3. SMTP_USER          (last-resort fallback for old envs)
//
// Display name is read from MAIL_FROM_NAME and applied only when present.

function getMailFromAddress() {
  return (
    process.env.MAIL_FROM_EMAIL
    || process.env.CONTACT_FROM
    || process.env.SMTP_USER
    || ''
  ).trim();
}

function getMailFromName() {
  return (process.env.MAIL_FROM_NAME || '').trim();
}

/**
 * Returns the formatted RFC 5322 "From" header value, e.g.
 *   `"1 Stop Instruction" <info@1stopinstruction.com>`
 * or just `info@1stopinstruction.com` when no display name is configured.
 * Returns an empty string only when no From email could be resolved at all
 * (caller should treat that as a configuration error).
 */
function getMailFrom() {
  const email = getMailFromAddress();
  if (!email) return '';
  const name = getMailFromName();
  if (!name) return email;
  // Quote the display name and strip any embedded double quotes to keep the
  // header well-formed even if MAIL_FROM_NAME contains punctuation.
  const safeName = name.replace(/"/g, "'");
  return `"${safeName}" <${email}>`;
}

/**
 * Optional Reply-To header value when MAIL_REPLY_TO is set. Most callers can
 * spread `...(getReplyTo() ? { replyTo: getReplyTo() } : {})` into mailOptions.
 */
function getReplyTo() {
  const replyTo = (process.env.MAIL_REPLY_TO || '').trim();
  return replyTo || undefined;
}

module.exports = {
  getMailFrom,
  getMailFromAddress,
  getMailFromName,
  getReplyTo,
};
