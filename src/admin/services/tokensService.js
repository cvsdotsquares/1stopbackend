const { clearTokensCache } = require('../../utils/tokenReplacer');

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function sanitizeTokenName(raw) {
  let name = trim(raw);
  if (name.startsWith('${') && name.endsWith('}')) {
    name = name.slice(2, -1);
  } else if (name.startsWith('{') && name.endsWith('}')) {
    name = name.slice(1, -1);
  }
  return name.trim();
}

const DEFAULT_LIMIT = 25;

async function listTokens(pool, { page = 1, limit = DEFAULT_LIMIT, search = '', sort = 'id', order = 'DESC' } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const take = Math.min(100, Math.max(1, Number(limit) || DEFAULT_LIMIT));
  const offset = (pageNum - 1) * take;

  let where = ' WHERE 1=1 ';
  const params = [];
  const searchTerm = trim(search);

  if (searchTerm) {
    where += ' AND (token_name LIKE ? OR token_value LIKE ?)';
    params.push(`%${searchTerm}%`, `%${searchTerm}%`);
  }

  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total FROM tokens ${where}`,
    params
  );
  const total = Number(countRow?.total) || 0;

  const validSortCols = ['id', 'token_name', 'created', 'modified'];
  const sortCol = validSortCols.includes(sort) ? sort : 'id';
  const sortOrder = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const [rows] = await pool.query(
    `SELECT id, token_name, token_value, created, modified 
     FROM tokens ${where} 
     ORDER BY ${sortCol} ${sortOrder} 
     LIMIT ?, ?`,
    [...params, offset, take]
  );

  return {
    items: rows || [],
    pagination: {
      page: pageNum,
      perPage: take,
      total,
      totalPages: Math.max(1, Math.ceil(total / take)),
    },
    filters: { search: searchTerm },
  };
}

async function getTokenById(pool, id) {
  const [rows] = await pool.query(
    'SELECT id, token_name, token_value, created, modified FROM tokens WHERE id = ? LIMIT 1',
    [Number(id)]
  );
  return rows?.[0] || null;
}

async function createToken(pool, body) {
  const tokenName = sanitizeTokenName(body.token_name);
  const tokenValue = trim(body.token_value);

  if (!tokenName) {
    return { ok: false, message: 'Token name is required' };
  }
  if (!tokenValue) {
    return { ok: false, message: 'Token value is required' };
  }

  const [existing] = await pool.query(
    'SELECT id FROM tokens WHERE token_name = ? LIMIT 1',
    [tokenName]
  );
  if (existing && existing.length > 0) {
    return { ok: false, message: `Token name "${tokenName}" already exists` };
  }

  const [result] = await pool.query(
    'INSERT INTO tokens (token_name, token_value, created, modified) VALUES (?, ?, NOW(), NOW())',
    [tokenName, tokenValue]
  );

  clearTokensCache();

  return {
    ok: true,
    id: result.insertId,
    message: 'Token created successfully',
  };
}

async function updateToken(pool, id, body) {
  const tokenId = Number(id);
  if (!tokenId) {
    return { ok: false, message: 'Invalid token ID' };
  }

  const tokenName = sanitizeTokenName(body.token_name);
  const tokenValue = trim(body.token_value);

  if (!tokenName) {
    return { ok: false, message: 'Token name is required' };
  }
  if (!tokenValue) {
    return { ok: false, message: 'Token value is required' };
  }

  const [existing] = await pool.query(
    'SELECT id FROM tokens WHERE id = ? LIMIT 1',
    [tokenId]
  );
  if (!existing || existing.length === 0) {
    return { ok: false, message: 'Token not found' };
  }

  const [duplicate] = await pool.query(
    'SELECT id FROM tokens WHERE token_name = ? AND id != ? LIMIT 1',
    [tokenName, tokenId]
  );
  if (duplicate && duplicate.length > 0) {
    return { ok: false, message: `Token name "${tokenName}" is already in use by another token` };
  }

  await pool.query(
    'UPDATE tokens SET token_name = ?, token_value = ?, modified = NOW() WHERE id = ?',
    [tokenName, tokenValue, tokenId]
  );

  clearTokensCache();

  return {
    ok: true,
    message: 'Token updated successfully',
  };
}

async function deleteToken(pool, id) {
  const tokenId = Number(id);
  if (!tokenId) {
    return { ok: false, message: 'Invalid token ID' };
  }

  const [existing] = await pool.query(
    'SELECT id, token_name FROM tokens WHERE id = ? LIMIT 1',
    [tokenId]
  );
  if (!existing || existing.length === 0) {
    return { ok: false, message: 'Token not found' };
  }

  await pool.query('DELETE FROM tokens WHERE id = ?', [tokenId]);

  clearTokensCache();

  return {
    ok: true,
    message: 'Token deleted successfully',
  };
}

module.exports = {
  listTokens,
  getTokenById,
  createToken,
  updateToken,
  deleteToken,
};
