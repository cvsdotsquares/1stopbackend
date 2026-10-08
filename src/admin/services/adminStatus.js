/** Active/inactive flags stored as 0 or 1 in CMS tables. */
function parseActiveStatus(value, fallback = 1) {
  if (value === 0 || value === '0' || value === false || value === 'false') {
    return 0;
  }
  if (value === 1 || value === '1' || value === true || value === 'true') {
    return 1;
  }
  return fallback === 0 ? 0 : 1;
}

module.exports = {
  parseActiveStatus,
};
