// src/utils/phpSerialize.js
//
// Minimal PHP-compatible `serialize()` implementation for the values we
// archive into `deleted_bookings.booking_data`. Matches PHP's output for
// strings, integers, floats, booleans, null, and (numerically- or string-
// keyed) plain objects / arrays - which is all the legacy snapshot uses.
//
// Mirrors the format produced by 1stop-php/admin/booking_refund_delete_common.php:
//   $booking_data = serialize(array('booking'=>..., 'attendee'=>..., 'course_info'=>...));
// so that PHP `unserialize()` on the legacy "Deleted Bookings" view keeps
// working for rows archived by the Node side.

function utf8ByteLength(str) {
    return Buffer.byteLength(str, 'utf8');
  }
  
  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
  }
  
  function serializeValue(value) {
    if (value === null || typeof value === 'undefined') {
      return 'N;';
    }
    if (typeof value === 'boolean') {
      return `b:${value ? 1 : 0};`;
    }
    if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        return `i:${value};`;
      }
      return `d:${value};`;
    }
    if (typeof value === 'bigint') {
      return `i:${value.toString()};`;
    }
    if (value instanceof Date) {
      const s = value.toISOString();
      return `s:${utf8ByteLength(s)}:"${s}";`;
    }
    if (typeof value === 'string') {
      return `s:${utf8ByteLength(value)}:"${value}";`;
    }
    if (Array.isArray(value)) {
      let body = '';
      value.forEach((item, idx) => {
        body += `i:${idx};${serializeValue(item)}`;
      });
      return `a:${value.length}:{${body}}`;
    }
    if (isPlainObject(value)) {
      const keys = Object.keys(value);
      let body = '';
      for (const key of keys) {
        const intKey = /^-?\d+$/.test(key) ? Number(key) : null;
        if (intKey !== null && Number.isInteger(intKey) && String(intKey) === key) {
          body += `i:${intKey};`;
        } else {
          body += `s:${utf8ByteLength(key)}:"${key}";`;
        }
        body += serializeValue(value[key]);
      }
      return `a:${keys.length}:{${body}}`;
    }
    // Fallback: stringify unknown shapes so we don't throw.
    const s = String(value);
    return `s:${utf8ByteLength(s)}:"${s}";`;
  }
  
  function phpSerialize(value) {
    return serializeValue(value);
  }
  
  module.exports = { phpSerialize };
  