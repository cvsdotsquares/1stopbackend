const crypto = require('crypto');

const SINGLE_USE_TYPES = new Set(['home_slider', 'cms_sidebar']);

const SECTION_TITLES = {
  home_slider: 'Home Slider',
  direct_access: 'Direct Access',
  our_services: 'Our Services',
  cheap_cbt_test_across_london: 'Cheap CBT Test Across London',
  cheap_cbt_test_london: 'Cheap CBT Test In London',
  expert_training: 'Expert Training for Every Rider',
  why_1stop: 'Why 1 Stop Instruction',
  our_exceptional: 'Our Exceptional Training Site',
  page_banner: 'Page Banner',
  dynamic_content: 'Dynamic Content',
  directions_parking: 'Directions & Parking',
  info_card: 'Info Card',
  price_card: 'Package Price Card',
  service_areas: 'Service Areas Section',
  accordion: 'Accordion',
  content_cards: 'Content Cards',
  process_steps: 'Process Steps',
  cms_sidebar: 'CMS Sidebar',
};

function newUuid() {
  return crypto.randomUUID();
}

function isSingleUse(sectionType) {
  return SINGLE_USE_TYPES.has(sectionType);
}

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function nowSql() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

module.exports = {
  SINGLE_USE_TYPES,
  SECTION_TITLES,
  newUuid,
  isSingleUse,
  trim,
  nowSql,
};
