/**
 * Parse PHP-style bracket keys from multipart text fields into nested objects.
 * Example: dynamic_content[0][title] -> { dynamic_content: [{ title: '...' }] }
 */
function nestFormBody(flat) {
  const result = {};
  if (!flat || typeof flat !== 'object') return result;

  for (const [key, value] of Object.entries(flat)) {
    if (!key.includes('[')) {
      result[key] = value;
      continue;
    }

    const tokens = [];
    const head = key.match(/^([^[]+)/);
    if (head) tokens.push(head[1]);
    const re = /\[(\d*)\]/g;
    let m;
    while ((m = re.exec(key)) !== null) {
      tokens.push(m[1] === '' ? null : Number(m[1]));
    }

    let cur = result;
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      const isLast = i === tokens.length - 1;
      const next = tokens[i + 1];

      if (typeof token === 'string') {
        if (isLast) {
          cur[token] = value;
          break;
        }
        if (typeof next === 'number') {
          if (!Array.isArray(cur[token])) cur[token] = [];
          cur = cur[token];
          i += 1;
          const idx = tokens[i];
          if (i === tokens.length - 1) {
            cur[idx] = value;
          } else {
            if (!cur[idx] || typeof cur[idx] !== 'object') cur[idx] = {};
            cur = cur[idx];
          }
        } else {
          if (!cur[token] || typeof cur[token] !== 'object' || Array.isArray(cur[token])) {
            cur[token] = {};
          }
          cur = cur[token];
        }
      } else if (typeof token === 'number') {
        if (isLast) {
          cur[token] = value;
        } else {
          if (!cur[token] || typeof cur[token] !== 'object') cur[token] = {};
          cur = cur[token];
        }
      }
    }
  }

  return result;
}

module.exports = { nestFormBody };
