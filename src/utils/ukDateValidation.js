function trim(value) {
  return value == null ? '' : String(value).trim();
}

function isCalendarValidUkDob(day, month, year) {
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function ukDobAgeOnDate(dobStr, onDate = new Date()) {
  const match = String(dobStr || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return -1;
  const day = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const year = Number.parseInt(match[3], 10);
  const birth = new Date(year, month - 1, day);
  let age = onDate.getFullYear() - birth.getFullYear();
  const monthDiff = onDate.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && onDate.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age;
}

/** Optional DOB: empty OK; DD/MM/YYYY must be a real calendar date (public form parity). */
function validateUkDateOfBirth(value, options = {}) {
  const raw = trim(value);
  if (!raw) return { valid: true };

  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return {
      valid: false,
      message: 'Please enter a valid date in dd/mm/yyyy format.',
    };
  }

  const day = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const year = Number.parseInt(match[3], 10);

  if (!isCalendarValidUkDob(day, month, year)) {
    return {
      valid: false,
      message: 'Please enter a valid date in dd/mm/yyyy format.',
    };
  }

  const minAge = options.minAge;
  if (minAge != null && Number.isFinite(minAge)) {
    const age = ukDobAgeOnDate(raw, options.referenceDate || new Date());
    if (age < minAge) {
      return {
        valid: false,
        message: 'You must be at least 16 years of age to register.',
      };
    }
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
