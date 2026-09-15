const SQLI_PATTERNS = [
  /(\band|\bor)\s+sleep\s*\(/i,
  /\bsleep\s*\(\s*\d+\s*\)\s*-{1,}/i,
  /\bbenchmark\s*\(/i,
  /\bwaitfor\s+delay\b/i,
  /\bunion\s+(all\s+)?select\b/i,
  /\binformation_schema\b/i,
  /\binto\s+(out|dump)file\b/i,
  /\bload_file\s*\(/i,
  /\bxp_cmdshell\b/i,
  /\bor\s+['"]?\d+['"]?\s*=\s*['"]?\d+/i,
  /(\s|^)(and|or)\s+\d+\s*=\s*\d+/i,
  /;\s*(drop|alter|truncate|insert|delete|update)\b/i,
  /'[\s]*or[\s]+'/i,
  /--\s*$/,
  /\/\*|\*\//,
];

const SKIP_SCAN_KEYS = new Set([
  'recaptchaToken',
  'recaptchaToken',
  'recaptcha_token',
  'password',
  'encryptedPassword',
  'currentPassword',
  'newPassword',
]);

function collectStrings(value, acc = [], key = '') {
  if (value == null) return acc;
  if (SKIP_SCAN_KEYS.has(key)) return acc;
  if (typeof value === 'string' || typeof value === 'number') {
    acc.push(String(value));
    return acc;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, acc));
    return acc;
  }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([childKey, item]) => collectStrings(item, acc, childKey));
  }
  return acc;
}

function isMaliciousString(value) {
  const text = String(value || '');
  if (!text) return false;
  return SQLI_PATTERNS.some((pattern) => pattern.test(text));
}

function bodyContainsMaliciousPayload(body) {
  return collectStrings(body).some(isMaliciousString);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanText(value, maxLen) {
  const text = String(value ?? '').replace(/\0/g, '').trim();
  if (!maxLen) return text;
  return text.slice(0, maxLen);
}

module.exports = {
  isMaliciousString,
  bodyContainsMaliciousPayload,
  escapeHtml,
  cleanText,
};
