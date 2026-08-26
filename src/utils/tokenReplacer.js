// src/utils/tokenReplacer.js
let tokensCache = null;
let tokensCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

function getPhpSiteUrlBase() {
  const rawBaseUrl = process.env.PHP_SITE_URL;
  if (!rawBaseUrl || typeof rawBaseUrl !== 'string') return '';
  return rawBaseUrl.trim().replace(/\/+$/, '');
}

function getSiteUrlBase() {
  const rawBaseUrl = process.env.SITE_URL;
  if (!rawBaseUrl || typeof rawBaseUrl !== 'string') return '';
  return rawBaseUrl.trim().replace(/\/+$/, '');
}

/**
 * Legacy production hosts that historically appeared inside CMS-authored
 * `src` / `href` attributes. We rewrite any of these to the appropriate
 * environment-specific host so staging / dev never end up pointing back at
 * production assets or pages.
 *
 * Anchored to the host boundary so a hostile string like
 * `https://1stopinstruction.com.evil.example/` is NOT considered a match.
 */
const LEGACY_HOST_PATTERN = /https?:\/\/(?:www\.)?1stopinstruction\.com(?=\/|\?|#|$|["'])/gi;

/**
 * Returns true when the URL's PATH ends in a file-style extension
 * (e.g. `.pdf`, `.jpg`, `.docx`). Query strings and fragments are stripped
 * before the check so `/foo/file.pdf?v=2#frag` is still classified as a
 * file. The hostname is intentionally excluded from the check so a bare
 * URL like `https://1stopinstruction.com` is NOT misread as having the
 * extension `.com`.
 */
function urlPathHasFileExtension(url) {
  if (!url || typeof url !== 'string') return false;

  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // Not a parseable absolute URL — treat the value itself as a path.
    pathname = url.split(/[?#]/)[0];
  }

  const lastSegment = pathname.split('/').filter(Boolean).pop() || '';
  return /\.[a-z0-9]{1,8}$/i.test(lastSegment);
}

/**
 * Rewrite legacy production hosts inside CMS-authored markup. Rules depend
 * on the attribute and the URL shape:
 *
 *   - `src="..."`  → always rewritten to PHP_SITE_URL (assets / images
 *                    are served by the legacy PHP host).
 *   - `href="..."` whose path ends in a file extension (e.g. `.pdf`,
 *                    `.docx`, `.jpg`) → rewritten to PHP_SITE_URL.
 *   - `href="..."` with no file extension (page links) → rewritten to
 *                    SITE_URL so they hit the new Next.js frontend.
 *
 * Both quoted and unquoted attribute values are handled. URLs that don't
 * begin with a legacy host are left untouched. Plain-text mentions of the
 * legacy hosts in body copy are also untouched — we only rewrite inside
 * `src` / `href` attributes.
 */
function rewriteLegacyHostInLinks(content) {
  if (!content || typeof content !== 'string') return content;

  const phpBase = getPhpSiteUrlBase();
  const siteBase = getSiteUrlBase();
  if (!phpBase && !siteBase) return content;

  const targetForAttr = (attrName, value) => {
    if (attrName === 'src') return phpBase;
    // href: file-style URLs go to the PHP host, page URLs go to the new site.
    return urlPathHasFileExtension(value) ? phpBase : siteBase;
  };

  const rewriteValue = (attrName, value) => {
    const target = targetForAttr(attrName, value);
    if (!target) return value;
    return value.replace(LEGACY_HOST_PATTERN, target);
  };

  const replaceInQuotedAttr = (match, prefix, attrName, quote, value) => {
    const replaced = rewriteValue(attrName.toLowerCase(), value);
    if (replaced === value) return match;
    return `${prefix}${quote}${replaced}${quote}`;
  };

  const replaceInUnquotedAttr = (match, prefix, attrName, value) => {
    const replaced = rewriteValue(attrName.toLowerCase(), value);
    if (replaced === value) return match;
    return `${prefix}${replaced}`;
  };

  return content
    .replaceAll(/(\b(src|href)\s*=\s*)(["'])([^"']*)\3/gi, replaceInQuotedAttr)
    .replaceAll(/(\b(src|href)\s*=\s*)([^\s"'>]+)/gi, replaceInUnquotedAttr);
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

  return rewriteLegacyHostInLinks(normalizeCkeditorImageSrcs(replacedContent));
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

module.exports = {
  replaceTokens,
  replaceTokensInObject,
  normalizeCkeditorImageSrcs,
  rewriteLegacyHostInLinks,
  urlPathHasFileExtension,
};