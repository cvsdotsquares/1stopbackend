// src/utils/tokenReplacer.js
let tokensCache = null;
let tokensCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

function getPhpSiteUrlBase() {
  const rawBaseUrl = process.env.PHP_SITE_URL;
  if (!rawBaseUrl || typeof rawBaseUrl !== 'string') return '';
  return rawBaseUrl.trim().replace(/\/+$/, '');
}

function normalizeCkeditorImageSrcs(content) {
  if (!content || typeof content !== 'string') return content;

  const baseUrl = getPhpSiteUrlBase();
  if (!baseUrl) return content;

  const isAbsoluteOrIgnored = (src) => {
    if (!src || typeof src !== 'string') return true;

    const trimmed = src.trim();
    return (
      /^https?:\/\//i.test(trimmed) ||
      trimmed.startsWith('//') ||
      /^(data:|blob:|mailto:|tel:|#)/i.test(trimmed)
    );
  };

  const toAbsoluteSrc = (src) => {
    const trimmed = src.trim();
    const baseLower = baseUrl.toLowerCase();

    if (trimmed.toLowerCase().startsWith(baseLower)) {
      return trimmed;
    }

    if (trimmed.startsWith('/')) {
      return `${baseUrl}${trimmed}`;
    }

    const relativeSrc = trimmed.replace(/^\.\//, '');
    return `${baseUrl}/${relativeSrc}`;
  };

  const normalizeQuotedSrc = (match, prefix, quote, srcValue) => {
    if (isAbsoluteOrIgnored(srcValue)) {
      return match;
    }

    return `${prefix}${quote}${toAbsoluteSrc(srcValue)}${quote}`;
  };

  const normalizeUnquotedSrc = (match, prefix, srcValue) => {
    if (isAbsoluteOrIgnored(srcValue)) {
      return match;
    }

    return `${prefix}${toAbsoluteSrc(srcValue)}`;
  };

  return content
    .replaceAll(/(<img\b[^>]*\bsrc\s*=\s*)(["'])([^"']+)\2/gi, normalizeQuotedSrc)
    .replaceAll(/(<img\b[^>]*\bsrc\s*=\s*)([^\s"'>]+)/gi, normalizeUnquotedSrc);
}

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

  return normalizeCkeditorImageSrcs(replacedContent);
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

module.exports = { replaceTokens, replaceTokensInObject, normalizeCkeditorImageSrcs };