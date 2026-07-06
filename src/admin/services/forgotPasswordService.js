const { mc_encrypt } = require('../../utils/universalPassword');
const { buildAdminForgotPasswordEmail } = require('../templates/adminForgotPasswordEmail');
const { sendAdminMail } = require('../utils/adminMailer');

function getEncryptionKey() {
  return process.env.UNIVERSAL_PASSWORD_KEY || process.env.ENCRYPTION_KEY;
}

/** Legacy randomPassword() — alphanumeric a-zA-Z0-9, length 10 */
function randomPassword(len = 10) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
  let pass = '';
  for (let i = 0; i < len; i += 1) {
    pass += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return pass;
}

function isValidEmail(email) {
  if (!email || typeof email !== 'string') {
    return false;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

async function processForgotPassword(pool, emailInput) {
  const user = String(emailInput || '').trim();

  const [rows] = await pool.query('SELECT * FROM admin WHERE admin_email = ? LIMIT 1', [user]);
  const adminRow = rows[0];

  if (!adminRow) {
    return {
      ok: false,
      status: 400,
      message: 'Invalid email given.',
    };
  }

  const adminEmail = String(adminRow.admin_email || '').trim();
  if (!adminEmail || !isValidEmail(adminEmail)) {
    return {
      ok: false,
      status: 400,
      message: 'Please provide valid email id',
    };
  }

  const keyHex = getEncryptionKey();
  if (!keyHex) {
    console.error('[ADMIN][AUTH][FORGOT-PASSWORD] ENCRYPTION_KEY not configured');
    return {
      ok: false,
      status: 500,
      message: 'Mail could not be sent. Please contact Site Super Administrator',
    };
  }

  const newPassword = randomPassword(10);
  const encryptedPass = mc_encrypt(newPassword, keyHex);

  await pool.query('UPDATE admin SET admin_pass = ? WHERE admin_email = ?', [
    encryptedPass,
    adminEmail,
  ]);

  const html = buildAdminForgotPasswordEmail(adminRow.admin_fristname, newPassword);
  const subject = 'Forgot Password mail';

  try {
    await sendAdminMail({
      to: { address: adminEmail, name: adminRow.admin_fristname || '' },
      subject,
      html,
      text: html,
    });
  } catch (err) {
    console.error('[ADMIN][AUTH][FORGOT-PASSWORD][MAIL]', err.message);
    return {
      ok: false,
      status: 500,
      message: 'Mail could not be sent. Please contact Site Super Administrator',
    };
  }

  return {
    ok: true,
    status: 200,
    message:
      'Mail sent successfully. Please login with new Password sent to your mail Id',
  };
}

module.exports = { processForgotPassword, randomPassword };
