const { mc_encrypt } = require('../../utils/universalPassword');
const { sendAdminForgotPasswordEmail } = require('../../utils/emailService');

const PASSWORD_ALPHABET =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';

function getEncryptionKey() {
  return process.env.UNIVERSAL_PASSWORD_KEY || process.env.ENCRYPTION_KEY;
}

function isValidEmail(value) {
  const email = String(value || '').trim();
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function randomPassword(length = 10) {
  const chars = [];
  for (let i = 0; i < length; i += 1) {
    const index = Math.floor(Math.random() * PASSWORD_ALPHABET.length);
    chars.push(PASSWORD_ALPHABET[index]);
  }
  return chars.join('');
}

/**
 * F-005 — Forgot password (legacy forgot_password.php parity).
 * Looks up admin by email, resets password, emails the new value.
 */
async function requestAdminForgotPassword(pool, emailRaw) {
  const email = String(emailRaw || '').trim();

  if (!isValidEmail(email)) {
    const err = new Error('Please provide valid email id');
    err.status = 400;
    throw err;
  }

  const [rows] = await pool.query(
    'SELECT admin_id, admin_email, admin_fristname, admin_lastname FROM admin WHERE admin_email = ? LIMIT 1',
    [email]
  );

  if (!rows || rows.length === 0) {
    const err = new Error('Invalid email given.');
    err.status = 404;
    err.code = 'INVALID_EMAIL';
    throw err;
  }

  const adminRow = rows[0];
  const keyHex = getEncryptionKey();
  if (!keyHex) {
    const err = new Error('Server configuration error');
    err.status = 500;
    throw err;
  }

  const newPassword = randomPassword(10);
  const encryptedPass = mc_encrypt(newPassword, keyHex);

  await pool.query('UPDATE admin SET admin_pass = ? WHERE admin_email = ?', [
    encryptedPass,
    adminRow.admin_email,
  ]);

  const mailSent = await sendAdminForgotPasswordEmail({
    email: adminRow.admin_email,
    firstName: adminRow.admin_fristname || '',
    newPassword,
  });

  if (!mailSent) {
    const err = new Error(
      'Mail could not be sent. Please contact Site Super Administrator'
    );
    err.status = 500;
    throw err;
  }

  return {
    message:
      'Mail sent successfully. Please login with new Password sent to your mail Id',
  };
}

module.exports = { requestAdminForgotPassword };
