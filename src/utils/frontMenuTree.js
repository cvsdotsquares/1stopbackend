/**
 * Build front-end navigation tree from page_menus rows.
 * Legacy column `front_menu_show`: 0 = show on front menu, 1 = hide from front menu.
 * Visible items whose parent is hidden are promoted under the nearest visible
 * ancestor (or root), so a child can appear without re-enabling the parent.
 */

function normalizeParentId(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function isHiddenFromFrontMenu(value) {
  return Number(value) === 1;
}

function isFrontMenuVisible(value) {
  return !isHiddenFromFrontMenu(value);
}

/**
 * @param {Array<Record<string, unknown>>} menuItems all rows for one menu_group
 */
function buildFrontMenuTree(menuItems) {
  const items = menuItems || [];
  const visible = items.filter((item) => isFrontMenuVisible(item.front_menu_show));
  const visibleIds = new Set(visible.map((item) => Number(item.id)));
  const byId = new Map(items.map((item) => [Number(item.id), item]));

  function effectiveParentId(item) {
    let pid = normalizeParentId(item.parent_id);
    const seen = new Set();
    while (pid && !visibleIds.has(pid)) {
      if (seen.has(pid)) return 0;
      seen.add(pid);
      const parent = byId.get(pid);
      if (!parent) return 0;
      pid = normalizeParentId(parent.parent_id);
    }
    return pid;
  }

  function sortItems(a, b) {
    const orderA = Number(a.sort_order) || 0;
    const orderB = Number(b.sort_order) || 0;
    if (orderA !== orderB) return orderA - orderB;
    return Number(a.id) - Number(b.id);
  }

  function build(parentId) {
    return visible
      .filter((item) => effectiveParentId(item) === parentId)
      .sort(sortItems)
      .map((item) => ({
        id: item.id,
        page_title: item.page_title,
        page_slug: item.page_slug,
        page_link_id: item.page_link_id,
        sort_order: item.sort_order,
        weight: item.sort_order,
        children: build(Number(item.id)),
      }));
  }

  return build(0);
}

module.exports = {
  buildFrontMenuTree,
  isFrontMenuVisible,
};
