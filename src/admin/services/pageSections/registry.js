const handlers = require('./types');
const { SECTION_TITLES, isSingleUse } = require('./constants');

function getHandler(sectionType) {
  const handler = handlers[sectionType];
  if (!handler) {
    throw new Error(`Unknown section type: ${sectionType}`);
  }
  return handler;
}

function listRegisteredTypes() {
  return Object.keys(handlers).map((title_slug) => ({
    title_slug,
    title: SECTION_TITLES[title_slug] || title_slug,
    single_use: isSingleUse(title_slug),
  }));
}

module.exports = {
  getHandler,
  listRegisteredTypes,
  handlers,
};
