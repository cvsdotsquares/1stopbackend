// src/utils/tokenReplacer.js
let tokensCache = null;
let tokensCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

async function getTokens(pool) {
  const now = Date.now();
  if (tokensCache && (now - tokensCacheTime) < CACHE_DURATION) {
    return tokensCache;
  }

  const [tokens] = await pool.query(`
    SELECT token_name, token_value FROM tokens
  `);

  tokensCache = {};
  tokens.forEach(token => {
    tokensCache[token.token_name] = token.token_value;
  });
  tokensCacheTime = now;

  return tokensCache;
}

async function replaceTokens(pool, content) {
  if (!content || typeof content !== 'string') return content;
  
  const tokens = await getTokens(pool);
  let replacedContent = content;

  Object.keys(tokens).forEach(tokenName => {
    const tokenPattern = new RegExp(`\\$\\{${tokenName}\\}`, 'g');
    replacedContent = replacedContent.replace(tokenPattern, tokens[tokenName]);
  });

  return replacedContent;
}

async function replaceTokensInObject(pool, obj) {
  if (!obj) return obj;
  
  if (typeof obj === 'string') {
    return await replaceTokens(pool, obj);
  }
  
  if (Array.isArray(obj)) {
    return Promise.all(obj.map(item => replaceTokensInObject(pool, item)));
  }
  
  if (typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = await replaceTokensInObject(pool, value);
    }
    return result;
  }
  
  return obj;
}

module.exports = { replaceTokens, replaceTokensInObject };