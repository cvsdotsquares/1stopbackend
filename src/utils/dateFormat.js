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

module.exports = {
  formatDateToDDMMYYYY,
  formatMySQLDateToDDMMYYYY
};
