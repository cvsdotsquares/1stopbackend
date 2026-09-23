function trim(value) {
  return value == null ? '' : String(value).trim();
}

/** Optional DOB: empty OK; DD/MM/YYYY must pass day/month/year checks (public form parity). */
function validateUkDateOfBirth(value) {
  const raw = trim(value);
  if (!raw) return { valid: true };

  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) {
    return {
      valid: false,
      message: 'Date of birth must be complete (DD/MM/YYYY)',
    };
  }

  const day = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const year = match[3];

  if (!Number.isFinite(day) || day < 1 || day > 31) {
    return { valid: false, message: 'Day (DD) must be between 01 and 31' };
  }
  if (!Number.isFinite(month) || month < 1 || month > 12) {
    return { valid: false, message: 'Month (MM) must be between 01 and 12' };
  }
  if (!/^19|^20/.test(year)) {
    return {
      valid: false,
      message: 'Year (YYYY) must start with 19 or 20',
    };
  }

  return { valid: true };
}

function sanitizePhoneInput(value) {
  return trim(value).replace(/[^\d+\s]/g, '');
}

module.exports = {
  validateUkDateOfBirth,
  sanitizePhoneInput,
};
