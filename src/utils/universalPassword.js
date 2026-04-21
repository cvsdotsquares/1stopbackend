// src/utils/universalPassword.js
//
// AES-256-CBC + HMAC-SHA256 helper compatible with the existing PHP admin
// panel's `mc_encrypt` / `mc_decrypt` output. Used ONLY for the server-side
// "universal password" admin-override feature.
//
// Wire format (matches PHP mc_encrypt): `${base64(ciphertext)}|${base64(iv)}`
// Decrypted plaintext layout:          `${phpSerializedValue}${hmacSha256HexOfValue}`
//
// Key handling mirrors PHP semantics:
// - UNIVERSAL_PASSWORD_KEY is a hex string. If its length is odd, PHP's
//   `pack('H*', $key)` treats it as if a trailing '0' nibble were present;
//   we replicate that here so the resulting buffer is 32 bytes.
// - HMAC key string = last 32 chars of hex(packedKey).
// - The serialized payload is PHP `serialize()` output, not JSON; we parse
//   the `s:<byteLen>:"<value>";` form and fall back to JSON for
//   forward compatibility.

const crypto = require('crypto');

const CIPHER = 'aes-256-cbc';
const MAC_HEX_LEN = 64; // sha256 -> 32 bytes -> 64 hex chars

function packHex(hex) {
  // Mirror PHP `pack('H*', $key)`: an odd-length hex string is treated as if
  // it had a trailing '0' nibble. Node's Buffer.from(..., 'hex') instead
  // silently drops the trailing nibble, producing a too-short key.
  const normalized = (typeof hex === 'string' && hex.length % 2 === 1)
    ? hex + '0'
    : hex;
  return Buffer.from(normalized || '', 'hex');
}

function deriveMacKey(keyBuffer) {
  return keyBuffer.toString('hex').slice(-32);
}

// Parse PHP `serialize()` output for a string value: `s:<byteLen>:"<bytes>";`.
// Returns the string content on success, or null if the input is not a
// serialized string. Byte length is validated against the declared length.
function parsePhpSerializedString(s) {
  if (typeof s !== 'string') return null;
  const m = /^s:(\d+):"([\s\S]*)";$/.exec(s);
  if (!m) return null;
  const declared = parseInt(m[1], 10);
  const content = m[2];
  if (Number.isNaN(declared)) return null;
  if (Buffer.byteLength(content, 'utf8') !== declared) return null;
  return content;
}

function mc_encrypt(value, keyHex) {
  const key = packHex(keyHex);
  if (key.length !== 32) {
    throw new Error('UNIVERSAL_PASSWORD_KEY must decode to a 32-byte key');
  }

  const serialized = JSON.stringify(value);
  const mac = crypto.createHmac('sha256', deriveMacKey(key)).update(serialized).digest('hex');
  const payload = serialized + mac;

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(CIPHER, key, iv);
  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);

  return `${encrypted.toString('base64')}|${iv.toString('base64')}`;
}

function mc_decrypt(encrypted, keyHex) {
  try {
    if (typeof encrypted !== 'string' || !encrypted.includes('|')) return false;

    const key = packHex(keyHex);
    if (key.length !== 32) return false;

    const sepIdx = encrypted.lastIndexOf('|');
    const dataB64 = encrypted.slice(0, sepIdx);
    const ivB64 = encrypted.slice(sepIdx + 1);
    if (!dataB64 || !ivB64) return false;

    const iv = Buffer.from(ivB64, 'base64');
    const encryptedData = Buffer.from(dataB64, 'base64');
    if (iv.length !== 16 || encryptedData.length === 0) return false;

    let decrypted;
    try {
      const decipher = crypto.createDecipheriv(CIPHER, key, iv);
      decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]).toString('utf8');
    } catch (_decErr) {
      return false;
    }

    if (decrypted.length < MAC_HEX_LEN) return false;

    const mac = decrypted.slice(-MAC_HEX_LEN);
    const value = decrypted.slice(0, -MAC_HEX_LEN);
    const calcMac = crypto.createHmac('sha256', deriveMacKey(key)).update(value).digest('hex');

    const macBuf = Buffer.from(mac, 'hex');
    const calcBuf = Buffer.from(calcMac, 'hex');
    if (macBuf.length !== calcBuf.length) return false;
    if (!crypto.timingSafeEqual(macBuf, calcBuf)) return false;

    // PHP admin panel uses `serialize()` (s:<len>:"<value>";), not JSON.
    // Try that first; fall back to JSON for forward compatibility.
    let parsed = parsePhpSerializedString(value);
    if (parsed === null) {
      try {
        parsed = JSON.parse(value);
      } catch (_parseErr) {
        return false;
      }
    }
    return parsed;
  } catch (_err) {
    // Intentionally swallow: never leak which step failed or any payload content.
    return false;
  }
}

async function getEncryptedUniversalPassword(pool) {
  try {
    const [rows] = await pool.query(
      'SELECT universal_password FROM settings WHERE id = 1 LIMIT 1'
    );
    if (!rows || rows.length === 0) return null;
    const value = rows[0].universal_password;
    if (!value || typeof value !== 'string') return null;
    return value;
  } catch (err) {
    console.error('[AUTH][UNIVERSAL_PASSWORD] Failed to read settings.universal_password:', err.message);
    return null;
  }
}

async function verifyUniversalPassword(pool, plainPassword) {
  if (!plainPassword || typeof plainPassword !== 'string') return false;

  const keyHex = process.env.UNIVERSAL_PASSWORD_KEY;
  if (!keyHex) {
    console.error('[AUTH][UNIVERSAL_PASSWORD] UNIVERSAL_PASSWORD_KEY not configured');
    return false;
  }

  const encrypted = await getEncryptedUniversalPassword(pool);
  if (!encrypted) return false;

  const decrypted = mc_decrypt(encrypted, keyHex);
  if (decrypted === false || typeof decrypted !== 'string' || decrypted.length === 0) {
    return false;
  }

  const a = Buffer.from(plainPassword, 'utf8');
  const b = Buffer.from(decrypted, 'utf8');
  if (a.length !== b.length) return false;

  try {
    return crypto.timingSafeEqual(a, b);
  } catch (_err) {
    return false;
  }
}

module.exports = {
  mc_encrypt,
  mc_decrypt,
  getEncryptedUniversalPassword,
  verifyUniversalPassword,
};
