/**
 * Format date to DD/MM/YYYY format
 * @param {Date|string} date - Date object or date string
 * @returns {string} Formatted date string in DD/MM/YYYY format
 */
const formatDateToDDMMYYYY = (date) => {
  if (!date) return '';
  
  const dateObj = date instanceof Date ? date : new Date(date);
  
  // Check if date is valid
  if (isNaN(dateObj.getTime())) return '';
  
  const day = String(dateObj.getDate()).padStart(2, '0');
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const year = dateObj.getFullYear();
  
  return `${day}/${month}/${year}`;
};

/**
 * Format MySQL date (YYYY-MM-DD) to DD/MM/YYYY
 * @param {string|Date} mysqlDate - MySQL date string in YYYY-MM-DD format or Date object
 * @returns {string} Formatted date string in DD/MM/YYYY format
 */
const formatMySQLDateToDDMMYYYY = (mysqlDate) => {
  if (!mysqlDate || mysqlDate === '0000-00-00') return '';
  
  // If it's already a Date object, use formatDateToDDMMYYYY
  if (mysqlDate instanceof Date) {
    return formatDateToDDMMYYYY(mysqlDate);
  }
  
  // Handle string format
  if (typeof mysqlDate !== 'string') return '';
  
  const [year, month, day] = mysqlDate.split('-');
  
  if (!year || !month || !day) return '';
  
  return `${day}/${month}/${year}`;
};

const getCurrentMysqlDateTime = (timeZone = 'Europe/London') => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
    .formatToParts(new Date())
    .reduce((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value;
      return acc;
    }, {});

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
};

module.exports = {
  formatDateToDDMMYYYY,
  formatMySQLDateToDDMMYYYY,
  getCurrentMysqlDateTime
};
