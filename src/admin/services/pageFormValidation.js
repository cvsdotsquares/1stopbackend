function trim(value) {
  return value == null ? '' : String(value).trim();
}

function isBlankRichText(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return true;
  const withoutTags = raw
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return withoutTags.length === 0;
}

const PAGE_REQUIRED_FIELD_LABELS = {
  page_title: 'Page Name',
  link_title: 'Navigation Text',
  page_content: 'Page Content',
  weight: 'Position of menu',
};

/**
 * Legacy fields hidden in admin UI — fill before validation/save.
 * @param {Record<string, unknown>} body
 */
function applyPageFormHiddenFieldDefaults(body) {
  if (!body || typeof body !== 'object') {
    return;
  }
  if (!trim(body.link_title)) {
    body.link_title = trim(body.page_title);
  }
  if (isBlankRichText(body.page_content)) {
    body.page_content = '<p></p>';
  }
  if (trim(body.weight) === '') {
    body.weight = '0';
  }
}

/**
 * @param {Record<string, unknown>} body
 * @returns {string[]} Human-readable labels for missing required fields.
 */
function collectMissingPageRequiredFields(body) {
  const missing = [];

  if (!trim(body.page_title)) {
    missing.push(PAGE_REQUIRED_FIELD_LABELS.page_title);
  }

  return missing;
}

function pageRequiredFieldsMessage(missingLabels) {
  if (!missingLabels?.length) {
    return null;
  }
  if (missingLabels.length === 1) {
    return `Required field cannot be left blank: ${missingLabels[0]}.`;
  }
  return `Required fields cannot be left blank: ${missingLabels.join(', ')}.`;
}

function validatePageRequiredFields(body) {
  applyPageFormHiddenFieldDefaults(body);
  const missing = collectMissingPageRequiredFields(body);
  if (!missing.length) {
    return { ok: true };
  }
  return {
    ok: false,
    message: pageRequiredFieldsMessage(missing),
    missingFields: missing,
  };
}

module.exports = {
  isBlankRichText,
  applyPageFormHiddenFieldDefaults,
  collectMissingPageRequiredFields,
  pageRequiredFieldsMessage,
  validatePageRequiredFields,
  PAGE_REQUIRED_FIELD_LABELS,
};
