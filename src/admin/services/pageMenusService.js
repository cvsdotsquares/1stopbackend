function trim(value) {
  return value == null ? '' : String(value).trim();
}

function parseId(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function mapMenuRow(row) {
  return {
    id: Number(row.id),
    page_title: row.page_title || '',
    page_slug: row.page_slug || '',
    // Keep 0 as null so roots match helper.getMenuStructure
    parent_id: normalizeParentId(row.parent_id),
    page_link_id: row.page_link_id ? Number(row.page_link_id) : null,
    menu_group: row.menu_group || null,
    sort_order: Number(row.sort_order) || 0,
    front_menu_show: Number(row.front_menu_show) ? 1 : 0,
    parent_menu_title: row.parent_menu_title || '',
    linked_page_title: row.linked_page_title || '',
    created_at: row.created_at || null,
  };
}

/** Same root rule as helper.getMenuStructure: null or 0. */
function normalizeParentId(value) {
  if (value == null || value === '' || Number(value) === 0) return null;
  return Number(value);
}

function getItemLevel(menuId, allMenus) {
  let level = 0;
  let currentId = menuId;
  const visited = new Set();
  const byId = new Map(allMenus.map((m) => [Number(m.id), m]));

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const item = byId.get(Number(currentId));
    if (!item || !item.parent_id) break;
    level += 1;
    currentId = Number(item.parent_id);
  }
  return level;
}

function getParentChainTitles(menuId, allMenus) {
  const chain = [];
  let currentId = menuId;
  const visited = new Set();
  const byId = new Map(allMenus.map((m) => [Number(m.id), m]));

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const item = byId.get(Number(currentId));
    if (!item) break;
    chain.push(item.page_title || '');
    currentId = item.parent_id ? Number(item.parent_id) : null;
  }
  return chain.reverse();
}

/**
 * Mirror helper.js getMenuStructure buildMenuTree:
 * - root: parent_id is null or 0
 * - child of X: parent_id === X.id
 * - sibling order: preserve input order (caller should ORDER BY id ASC)
 *
 * Admin includes front_menu_show=1 items (public API filters those out).
 */
function buildMenuTree(items, parentId = null, level = 0) {
  const mappedById = new Map(
    items.map((row) => {
      const mapped = mapMenuRow(row);
      return [mapped.id, mapped];
    })
  );

  function walk(currentParentId, currentLevel) {
    return items
      .filter((item) => {
        const pid = normalizeParentId(item.parent_id);
        if (currentParentId === null) return pid === null;
        return pid === Number(currentParentId);
      })
      .sort((a, b) => {
        const sortA = Number(a.sort_order) || 0;
        const sortB = Number(b.sort_order) || 0;
        if (sortA !== sortB) return sortA - sortB;
        return Number(a.id) - Number(b.id);
      })
      .map((item) => {
        const mapped = mappedById.get(Number(item.id)) || mapMenuRow(item);
        const children = walk(Number(item.id), currentLevel + 1);
        let hierarchy_path = 'Root Level';
        if (mapped.parent_id) {
          const chain = [];
          let cursor = mapped.parent_id;
          const seen = new Set();
          while (cursor && !seen.has(cursor)) {
            seen.add(cursor);
            const parent = mappedById.get(Number(cursor));
            if (!parent) break;
            chain.unshift(parent.page_title);
            cursor = parent.parent_id;
          }
          if (chain.length) {
            chain.push(mapped.page_title);
            hierarchy_path = chain.join(' > ');
          }
        }
        return {
          ...mapped,
          level: currentLevel,
          hierarchy_path,
          children,
        };
      });
  }

  return walk(parentId, level);
}

function countTreeNodes(nodes) {
  let n = 0;
  for (const node of nodes || []) {
    n += 1 + countTreeNodes(node.children);
  }
  return n;
}

async function fetchAllMenus(pool, groupName = null) {
  let sql = `
    SELECT pm.*, parent.page_title AS parent_menu_title, p.page_title AS linked_page_title
    FROM page_menus pm
    LEFT JOIN page_menus parent ON pm.parent_id = parent.id
    LEFT JOIN pages p ON pm.page_link_id = p.id
  `;
  const params = [];
  if (groupName != null && groupName !== '') {
    sql += ' WHERE pm.menu_group = ?';
    params.push(groupName);
  }
  // Match public menu-structure ordering so sibling order is identical
  sql += ' ORDER BY pm.sort_order ASC, pm.id ASC';
  const [rows] = await pool.query(sql, params);
  return rows || [];
}

async function listPageMenus(pool) {
  const rows = await fetchAllMenus(pool);
  const groupsMap = new Map();

  for (const row of rows) {
    const group = row.menu_group || 'No Group';
    if (!groupsMap.has(group)) groupsMap.set(group, []);
    groupsMap.get(group).push(row);
  }

  const groups = [];
  for (const [groupName, groupRows] of groupsMap.entries()) {
    const tree = buildMenuTree(groupRows, null, 0);
    groups.push({
      group_name: groupName,
      count: countTreeNodes(tree),
      items: tree,
    });
  }

  return { groups, total: rows.length };
}

async function getPageMenuById(pool, id) {
  const [rows] = await pool.query(
    `SELECT pm.*, parent.page_title AS parent_menu_title, p.page_title AS linked_page_title
     FROM page_menus pm
     LEFT JOIN page_menus parent ON pm.parent_id = parent.id
     LEFT JOIN pages p ON pm.page_link_id = p.id
     WHERE pm.id = ?
     LIMIT 1`,
    [id]
  );
  if (!rows.length) return null;
  const menu = mapMenuRow(rows[0]);
  const all = (await fetchAllMenus(pool)).map(mapMenuRow);
  menu.level = getItemLevel(menu.id, all);
  menu.hierarchy_path = menu.parent_id
    ? [...getParentChainTitles(menu.parent_id, all), menu.page_title].join(' > ')
    : 'Root Level';
  return menu;
}

async function getFormOptions(pool, { excludeMenuId = null, groupName = null } = {}) {
  const [[pages], [groups]] = await Promise.all([
    pool.query('SELECT id, page_title FROM pages ORDER BY page_title ASC'),
    pool.query(
      'SELECT id, group_name, group_type FROM menu_groups ORDER BY group_type ASC, group_name ASC'
    ),
  ]);

  let parentSql = 'SELECT id, page_title, menu_group FROM page_menus';
  const parentParams = [];
  const parentWhere = [];
  if (excludeMenuId) {
    parentWhere.push('id != ?');
    parentParams.push(excludeMenuId);
  }
  if (groupName) {
    parentWhere.push('menu_group = ?');
    parentParams.push(groupName);
  }
  if (parentWhere.length) {
    parentSql += ` WHERE ${parentWhere.join(' AND ')}`;
  }
  parentSql += ' ORDER BY page_title ASC';
  const [parentMenus] = await pool.query(parentSql, parentParams);

  return {
    pages: (pages || []).map((p) => ({ id: p.id, label: p.page_title })),
    parent_menus: (parentMenus || []).map((p) => ({
      id: p.id,
      label: p.page_title,
      menu_group: p.menu_group || null,
    })),
    groups: (groups || []).map((g) => ({
      id: g.id,
      group_name: g.group_name,
      group_type: g.group_type,
    })),
  };
}

async function wouldCreateCycle(pool, menuId, parentId) {
  if (!parentId) return false;
  if (Number(parentId) === Number(menuId)) return true;
  let currentId = parentId;
  const visited = new Set([Number(menuId)]);
  while (currentId) {
    if (visited.has(Number(currentId))) return true;
    visited.add(Number(currentId));
    const [rows] = await pool.query(
      'SELECT parent_id FROM page_menus WHERE id = ? LIMIT 1',
      [currentId]
    );
    if (!rows.length) break;
    currentId = rows[0].parent_id ? Number(rows[0].parent_id) : null;
  }
  return false;
}

async function createPageMenu(pool, body = {}) {
  const pageTitle = trim(body.page_title);
  const pageSlug = trim(body.page_slug);
  if (!pageTitle || !pageSlug) {
    return { ok: false, message: 'Page title and slug are required' };
  }

  const parentId = parseId(body.parent_id) || 0;
  const pageLinkId = parseId(body.page_link_id) || 0;
  const menuGroup = trim(body.menu_group) || null;
  const frontMenuShow = Number(body.front_menu_show) ? 1 : 0;
  const sortOrder = parseId(body.sort_order) || 1;

  const [result] = await pool.query(
    `INSERT INTO page_menus (
      page_title, page_slug, parent_id, page_link_id, menu_group, sort_order, front_menu_show
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      pageTitle,
      pageSlug,
      parentId || null,
      pageLinkId || null,
      menuGroup,
      sortOrder,
      frontMenuShow,
    ]
  );

  const newId = result.insertId;
  // Legacy add_page_menu sets sort_order = new id when not in a group context
  if (!body.sort_order) {
    await pool.query('UPDATE page_menus SET sort_order = ? WHERE id = ?', [
      newId,
      newId,
    ]);
  }

  return {
    ok: true,
    message: 'Page Menu added successfully',
    data: { id: newId },
  };
}

async function updatePageMenu(pool, id, body = {}) {
  const existing = await getPageMenuById(pool, id);
  if (!existing) {
    return { ok: false, message: 'Page Menu not found' };
  }

  const pageTitle = trim(body.page_title);
  const pageSlug = trim(body.page_slug);
  if (!pageTitle || !pageSlug) {
    return { ok: false, message: 'Page title and slug are required' };
  }

  const parentId = Object.prototype.hasOwnProperty.call(body, 'parent_id')
    ? parseId(body.parent_id) || null
    : existing.parent_id;
  const pageLinkId = Object.prototype.hasOwnProperty.call(body, 'page_link_id')
    ? parseId(body.page_link_id) || null
    : existing.page_link_id;
  const menuGroup = Object.prototype.hasOwnProperty.call(body, 'menu_group')
    ? trim(body.menu_group) || null
    : existing.menu_group;
  const frontMenuShow = Object.prototype.hasOwnProperty.call(
    body,
    'front_menu_show'
  )
    ? Number(body.front_menu_show)
      ? 1
      : 0
    : existing.front_menu_show;

  if (parentId && (await wouldCreateCycle(pool, id, parentId))) {
    return {
      ok: false,
      message: 'A menu item cannot be its own parent',
    };
  }

  await pool.query(
    `UPDATE page_menus SET
      page_title = ?, page_slug = ?, parent_id = ?, page_link_id = ?,
      menu_group = ?, front_menu_show = ?
     WHERE id = ?`,
    [
      pageTitle,
      pageSlug,
      parentId,
      pageLinkId,
      menuGroup,
      frontMenuShow,
      id,
    ]
  );

  return { ok: true, message: 'Page Menu updated successfully', data: { id } };
}

async function deletePageMenu(pool, id) {
  const [result] = await pool.query('DELETE FROM page_menus WHERE id = ?', [id]);
  if (!result.affectedRows) {
    return { ok: false, message: 'Error deleting page menu' };
  }
  return { ok: true, message: 'Page Menu deleted successfully' };
}

async function updateSortOrder(pool, ids = []) {
  if (!Array.isArray(ids) || !ids.length) {
    return { ok: false, message: 'Invalid request' };
  }
  for (let i = 0; i < ids.length; i += 1) {
    const id = parseId(ids[i]);
    if (!id) continue;
    await pool.query('UPDATE page_menus SET sort_order = ? WHERE id = ?', [
      i + 1,
      id,
    ]);
  }
  return { ok: true, message: 'Sort order updated' };
}

async function updateGroupSort(pool, items = []) {
  if (!Array.isArray(items) || !items.length) {
    return { ok: false, message: 'Items parameter missing or invalid' };
  }

  // Validate no item is parented under itself or a descendant (cycle)
  const parentById = new Map();
  for (const item of items) {
    const id = parseId(item.id);
    if (!id) continue;
    parentById.set(id, parseId(item.parent_id));
  }
  for (const [id, parentId] of parentById.entries()) {
    if (!parentId) continue;
    if (parentId === id) {
      return { ok: false, message: 'A menu item cannot be its own parent' };
    }
    let cursor = parentId;
    const seen = new Set([id]);
    while (cursor) {
      if (seen.has(cursor)) {
        return {
          ok: false,
          message: 'Invalid hierarchy: circular parent reference',
        };
      }
      seen.add(cursor);
      cursor = parentById.get(cursor) || null;
    }
  }

  const ids = [...parentById.keys()];
  const [currentRows] = await pool.query(
    `SELECT id, sort_order, menu_group, parent_id FROM page_menus WHERE id IN (${ids
      .map(() => '?')
      .join(',')})`,
    ids
  );
  const currentById = new Map(
    (currentRows || []).map((row) => [Number(row.id), row])
  );

  const connection = await pool.getConnection();
  let updatedCount = 0;
  try {
    await connection.beginTransaction();
    for (const item of items) {
      const id = parseId(item.id);
      if (!id) continue;
      const sortOrder = Number(item.sort) || 1;
      const groupRaw = trim(item.group);
      const group = !groupRaw || groupRaw === 'No Group' ? null : groupRaw;
      const parentId = parseId(item.parent_id) || null;

      // Skip rows that already hold these values so untouched menus keep
      // their existing row state on the live site.
      const current = currentById.get(id);
      if (
        current &&
        Number(current.sort_order) === sortOrder &&
        (current.menu_group || null) === group &&
        (parseId(current.parent_id) || null) === parentId
      ) {
        continue;
      }

      await connection.query(
        'UPDATE page_menus SET sort_order = ?, menu_group = ?, parent_id = ? WHERE id = ?',
        [sortOrder, group, parentId, id]
      );
      updatedCount += 1;
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return {
    ok: true,
    message: `Updated ${updatedCount} items`,
    data: { count: updatedCount },
  };
}

async function listMenuGroups(pool) {
  const [groups] = await pool.query(
    'SELECT * FROM menu_groups ORDER BY group_type ASC, group_name ASC'
  );
  const items = [];
  for (const group of groups || []) {
    const [countRows] = await pool.query(
      'SELECT COUNT(*) AS count FROM page_menus WHERE menu_group = ?',
      [group.group_name]
    );
    items.push({
      id: group.id,
      group_name: group.group_name,
      group_type: group.group_type,
      menus_count: Number(countRows?.[0]?.count) || 0,
    });
  }
  return { items };
}

async function createMenuGroup(pool, body = {}) {
  const groupName = trim(body.group_name);
  const groupType = trim(body.group_type);
  if (!groupName || !groupType) {
    return { ok: false, message: 'Group name and type are required' };
  }
  if (!['Header', 'Footer'].includes(groupType)) {
    return { ok: false, message: 'Group type must be Header or Footer' };
  }

  const [existing] = await pool.query(
    'SELECT id FROM menu_groups WHERE group_name = ? LIMIT 1',
    [groupName]
  );
  if (existing.length) {
    return { ok: false, message: 'A group with this name already exists' };
  }

  const [result] = await pool.query(
    'INSERT INTO menu_groups (group_name, group_type) VALUES (?, ?)',
    [groupName, groupType]
  );
  return {
    ok: true,
    message: 'Menu Group added successfully',
    data: { id: result.insertId, group_name: groupName },
  };
}

async function renameMenuGroup(pool, oldName, newName) {
  const from = trim(oldName);
  const to = trim(newName);
  if (!from || !to) {
    return { ok: false, message: 'Group name is required' };
  }
  if (from === to) {
    return { ok: true, message: 'Group renamed successfully', data: { group_name: to } };
  }

  await pool.query(
    'UPDATE page_menus SET menu_group = ? WHERE menu_group = ?',
    [to, from]
  );
  await pool.query(
    'UPDATE menu_groups SET group_name = ? WHERE group_name = ?',
    [to, from]
  );
  return {
    ok: true,
    message: 'Group renamed successfully',
    data: { group_name: to },
  };
}

async function deleteMenuGroup(pool, id) {
  const [rows] = await pool.query(
    'SELECT group_name FROM menu_groups WHERE id = ? LIMIT 1',
    [id]
  );
  if (!rows.length) {
    return { ok: false, message: 'Group not found' };
  }
  const groupName = rows[0].group_name;
  await pool.query(
    'UPDATE page_menus SET menu_group = NULL WHERE menu_group = ?',
    [groupName]
  );
  await pool.query('DELETE FROM menu_groups WHERE id = ?', [id]);
  return {
    ok: true,
    message: 'Menu Group deleted successfully. All menus moved to "No Group"',
  };
}

async function listGroupMenus(pool, groupName) {
  const name = trim(groupName);
  if (!name) {
    return { ok: false, message: 'Invalid group' };
  }
  const rows = await fetchAllMenus(pool, name);
  return {
    ok: true,
    data: {
      group_name: name,
      items: rows.map(mapMenuRow),
    },
  };
}

module.exports = {
  listPageMenus,
  getPageMenuById,
  getFormOptions,
  createPageMenu,
  updatePageMenu,
  deletePageMenu,
  updateSortOrder,
  updateGroupSort,
  listMenuGroups,
  createMenuGroup,
  renameMenuGroup,
  deleteMenuGroup,
  listGroupMenus,
};
