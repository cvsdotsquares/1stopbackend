/**
 * UK photocard driving licence validation (legacy admin parity) plus
 * Northern Ireland 8-digit numeric licences.
 */

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function normalizeDrivingLicence(value) {
  return trim(value).toUpperCase().replace(/\s+/g, '');
}

function isNorthernIrelandDrivingLicence(value) {
  return /^\d{8}$/.test(value);
}

/** Legacy admin parity: 16-char DVLA layout only (no DOB digit plausibility check). */
function isValidUkPhotocardLicence(value) {
  if (value.length !== 16) return false;
  if (!/^[A-Z0-9]+$/.test(value)) return false;
  return /^[A-Z9]{5}\d[A-Z0-9]{10}$/.test(value);
}

/**
 * @returns {{ valid: boolean, message?: string, kind?: 'empty'|'ni'|'uk' }}
 */
function validateDrivingLicenceNumber(value, { required = false } = {}) {
  const licence = normalizeDrivingLicence(value);
  if (!licence) {
    if (required) {
      return {
        valid: false,
        kind: 'empty',
        message: 'Driving licence number is required',
      };
    }
    return { valid: true };
  }

  if (isNorthernIrelandDrivingLicence(licence)) {
    return { valid: true, kind: 'ni' };
  }

  if (!isValidUkPhotocardLicence(licence)) {
    return {
      valid: false,
      kind: 'uk',
      message:
        'Driving licence number is not valid. Enter a 16-character UK photocard licence or an 8-digit Northern Ireland licence.',
    };
  }

  return { valid: true, kind: 'uk' };
}

module.exports = {
  normalizeDrivingLicence,
  isNorthernIrelandDrivingLicence,
  isValidUkPhotocardLicence,
  validateDrivingLicenceNumber,
};
