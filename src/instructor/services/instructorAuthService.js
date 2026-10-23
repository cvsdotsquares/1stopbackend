const { mc_decrypt } = require('../../utils/universalPassword');

function getEncryptionKey() {
  return process.env.UNIVERSAL_PASSWORD_KEY || process.env.ENCRYPTION_KEY;
}

/**
 * Authenticates an instructor against the `itineraries` table.
 * Legacy parity: `select * from itineraries where username = :0 AND status = :1`
 * password verified via `mc_decrypt(sqlSet.pass, ENCRYPTION_KEY)`.
 */
async function authenticateInstructor(pool, username, rawPassword) {
  if (!username || !rawPassword) {
    return { ok: false, message: 'Username and password incorrect.' };
  }

  const [rows] = await pool.query(
    `SELECT i.*, l.location_name
     FROM itineraries i
     LEFT JOIN locations l ON l.id = i.location
     WHERE i.status = 1 AND i.username = ?
     LIMIT 1`,
    [username]
  );

  if (!rows || rows.length === 0) {
    return { ok: false, message: 'Username and password incorrect.' };
  }

  const instructor = rows[0];
  const keyHex = getEncryptionKey();
  if (!keyHex) {
    console.error('[INSTRUCTOR][AUTH][LOGIN] ENCRYPTION_KEY not configured');
    return { ok: false, message: 'Server configuration error' };
  }

  const decryptedPass = mc_decrypt(instructor.pass, keyHex);
  if (decryptedPass === false || rawPassword !== decryptedPass) {
    return { ok: false, message: 'Username and password incorrect.' };
  }

  // Update last_login timestamp (matches legacy UPDATE itineraries SET last_login = NOW())
  try {
    await pool.query(
      'UPDATE itineraries SET last_login = NOW() WHERE id = ?',
      [instructor.id]
    );
  } catch (updateErr) {
    console.error('[INSTRUCTOR][AUTH][LOGIN] Failed to update last_login:', updateErr.message);
  }

  return {
    ok: true,
    instructor,
  };
}

module.exports = {
  authenticateInstructor,
};
