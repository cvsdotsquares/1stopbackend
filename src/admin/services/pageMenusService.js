function trim(value) {
  return value == null ? '' : String(value).trim();
}

/** Legacy DB: front_menu_show 0 = visible on front, 1 = hidden from front */
function parseFrontMenuShow(value) {
  if (value === 1 || value === '1' || value === true || value === 'true') {
    return 1;
  }
  if (value === 0 || value === '0' || value === false || value === 'false') {
    return 0;
  }
  return 0;
}

function resolveFrontMenuShow(body, existingMenu = null) {
  const hasHide =
    body &&
    Object.prototype.hasOwnProperty.call(body, 'hide_from_front') &&
    body.hide_from_front !== undefined &&
    body.hide_from_front !== null;
  const hasLegacy =
    body &&
    Object.prototype.hasOwnProperty.call(body, 'front_menu_show') &&
    body.front_menu_show !== undefined &&
    body.front_menu_show !== null;

  if (hasHide) {
    return parseFrontMenuShow(body.hide_from_front);
  }
  if (hasLegacy) {
    return parseFrontMenuShow(body.front_menu_show);
  }
  if (existingMenu) {
    return Number(existingMenu.front_menu_show) === 1 ? 1 : 0;
  }
  return 0;
}

function getItemLevel(menuId, allMenus) {
  let level = 0;
  let currentId = menuId;
  const visited = new Set();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const m = allMenus.find((row) => row.id === currentId);
    if (!m?.parent_id) break;
    level += 1;
    currentId = m.parent_id;
  }
  return level;
}

function getParentChain(parentId, allMenus) {
  const chain = [];
  let currentId = parentId;
  const visited = new Set();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const m = allMenus.find((row) => row.id === currentId);
    if (!m) break;
    chain.push(m.page_title);
    currentId = m.parent_id;
  }
  return chain.reverse();
}

async function fetchAllMenus(pool) {
  const [rows] = await pool.query(`
    SELECT pm.*, parent.page_title AS parent_menu_title, p.page_title AS linked_page_title
    FROM page_menus pm
    LEFT JOIN page_menus parent ON pm.parent_id = parent.id
    LEFT JOIN pages p ON pm.page_link_id = p.id
    ORDER BY pm.menu_group ASC, pm.sort_order ASC, pm.id ASC
  `);
  return rows || [];
}

async function listPageMenusTree(pool) {
  const allMenus = await fetchAllMenus(pool);
  const groups = new Map();

  for (const menu of allMenus) {
    const group = menu.menu_group || 'No Group';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(menu);
  }

  const result = [];
  for (const [groupName, groupMenus] of groups.entries()) {
    const sorted = [...groupMenus].sort((a, b) => {
      const levelA = getItemLevel(a.id, allMenus);
      const levelB = getItemLevel(b.id, allMenus);
      if (levelA !== levelB) return levelA - levelB;
      const parentA = a.parent_id ?? 0;
      const parentB = b.parent_id ?? 0;
      if (parentA !== parentB) return parentA - parentB;
      if ((a.sort_order ?? 0) !== (b.sort_order ?? 0)) {
        return (a.sort_order ?? 0) - (b.sort_order ?? 0);
      }
      return a.id - b.id;
    });

    result.push({
      groupName,
      items: sorted.map((menu) => {
        const level = getItemLevel(menu.id, allMenus);
        let hierarchyPath = 'Root Level';
        if (menu.parent_id) {
          const chain = getParentChain(menu.parent_id, allMenus);
          chain.push(menu.page_title);
          hierarchyPath = chain.join(' > ');
        }
        return {
          ...menu,
          level,
          hierarchyPath,
        };
      }),
    });
  }

  return { groups: result, allMenus };
}

async function listMenuGroups(pool) {
  const [rows] = await pool.query(
    'SELECT * FROM menu_groups ORDER BY group_type, group_name'
  );
  return rows || [];
}

async function createMenuGroup(pool, body) {
  const group_name = trim(body.group_name);
  const group_type = trim(body.group_type);
  if (!group_name || !group_type) {
    return { ok: false, message: 'Group name and type are required' };
  }
  const [result] = await pool.query(
    'INSERT INTO menu_groups (group_name, group_type) VALUES (?, ?)',
    [group_name, group_type]
  );
  return { ok: true, message: 'Menu Group added successfully', id: result.insertId };
}

async function deleteMenuGroup(pool, id) {
  const [rows] = await pool.query('SELECT group_name FROM menu_groups WHERE id = ? LIMIT 1', [
    Number(id),
  ]);
  if (!rows?.length) {
    return { ok: false, message: 'Group not found' };
  }
  const group_name = rows[0].group_name;
  await pool.query('UPDATE page_menus SET menu_group = NULL WHERE menu_group = ?', [
    group_name,
  ]);
  await pool.query('DELETE FROM menu_groups WHERE id = ?', [Number(id)]);
  return {
    ok: true,
    message: 'Menu Group deleted successfully. All menus moved to "No Group"',
  };
}

async function renameMenuGroup(pool, oldName, newName) {
  const from = trim(oldName);
  const to = trim(newName);
  if (!from || !to) {
    return { ok: false, message: 'Group name is required' };
  }
  await pool.query('UPDATE menu_groups SET group_name = ? WHERE group_name = ?', [to, from]);
  await pool.query('UPDATE page_menus SET menu_group = ? WHERE menu_group = ?', [to, from]);
  return { ok: true, message: 'Group renamed successfully' };
}

async function getPageMenuById(pool, id) {
  const [rows] = await pool.query('SELECT * FROM page_menus WHERE id = ? LIMIT 1', [
    Number(id),
  ]);
  return rows?.[0] || null;
}

async function createPageMenu(pool, body) {
  const page_title = trim(body.page_title);
  const page_slug = trim(body.page_slug);
  const menu_group = trim(body.menu_group) || null;
  const parent_id = Number(body.parent_id || body.page_id) || 0;
  const page_link_id = Number(body.page_link_id || body.linked_page_id) || 0;
  const front_menu_show = resolveFrontMenuShow(body);

  if (!page_title || !page_slug) {
    return { ok: false, message: 'Page title and slug are required' };
  }

  const [result] = await pool.query(
    `INSERT INTO page_menus
      (page_title, page_slug, parent_id, page_link_id, menu_group, sort_order, front_menu_show, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, NOW())`,
    [
      page_title,
      page_slug,
      parent_id || null,
      page_link_id || null,
      menu_group,
      front_menu_show,
    ]
  );
  const newId = result.insertId;
  await pool.query('UPDATE page_menus SET sort_order = ? WHERE id = ?', [newId, newId]);

  return { ok: true, message: 'Page Menu added successfully', id: newId };
}

async function updatePageMenu(pool, id, body) {
  const menu = await getPageMenuById(pool, id);
  if (!menu) {
    return { ok: false, message: 'Page Menu not found' };
  }

  const page_title = trim(body.page_title);
  const page_slug = trim(body.page_slug);
  const menu_group = trim(body.menu_group) || menu.menu_group || null;
  const parent_menu_id = Number(body.parent_menu_id ?? body.parent_id) || 0;
  const linked_page_id = Number(body.linked_page_id ?? body.page_link_id) || 0;
  const front_menu_show = resolveFrontMenuShow(body, menu);

  if (!page_title || !page_slug) {
    return { ok: false, message: 'Page title and slug are required' };
  }
  if (parent_menu_id === Number(id)) {
    return { ok: false, message: 'A menu item cannot be its own parent' };
  }

  await pool.query(
    `UPDATE page_menus SET page_title = ?, page_slug = ?, parent_id = ?, page_link_id = ?, menu_group = ?, front_menu_show = ?
     WHERE id = ?`,
    [
      page_title,
      page_slug,
      parent_menu_id || null,
      linked_page_id || null,
      menu_group,
      front_menu_show,
      Number(id),
    ]
  );

  return { ok: true, message: 'Page Menu updated successfully' };
}

async function deletePageMenu(pool, id) {
  const menu = await getPageMenuById(pool, id);
  if (!menu) {
    return { ok: false, message: 'Error deleting page menu' };
  }
  await pool.query('DELETE FROM page_menus WHERE id = ?', [Number(id)]);
  return { ok: true, message: 'Page Menu deleted successfully' };
}

async function updateGroupSort(pool, items) {
  if (!Array.isArray(items)) {
    return { ok: false, message: 'Items parameter missing or invalid' };
  }

  let updatedCount = 0;
  for (const item of items) {
    if (!item?.id) continue;
    const menuId = Number(item.id);
    const sort_order = Number(item.sort) || 1;
    const groupRaw = trim(item.group) || 'No Group';
    const group = groupRaw === 'No Group' ? null : groupRaw;

    let parent_id = null;
    if (
      item.parent_id !== null &&
      item.parent_id !== undefined &&
      item.parent_id !== '' &&
      item.parent_id !== '0' &&
      item.parent_id !== 0
    ) {
      parent_id = Number(item.parent_id);
    }

    if (parent_id === null) {
      await pool.query(
        'UPDATE page_menus SET sort_order = ?, menu_group = ?, parent_id = NULL WHERE id = ?',
        [sort_order, group, menuId]
      );
    } else {
      await pool.query(
        'UPDATE page_menus SET sort_order = ?, menu_group = ?, parent_id = ? WHERE id = ?',
        [sort_order, group, parent_id, menuId]
      );
    }
    updatedCount += 1;
  }

  return {
    ok: true,
    message: `Updated ${updatedCount} items`,
    count: updatedCount,
  };
}

async function updateFlatSort(pool, ids) {
  if (!Array.isArray(ids)) {
    return { ok: false, message: 'Invalid request' };
  }
  for (let position = 0; position < ids.length; position += 1) {
    const menuId = Number(ids[position]);
    const sort_order = position + 1;
    await pool.query('UPDATE page_menus SET sort_order = ? WHERE id = ?', [
      sort_order,
      menuId,
    ]);
  }
  return { ok: true, message: 'Sort order updated' };
}

async function getPageMenuFormOptions(pool) {
  const [pages] = await pool.query('SELECT id, page_title FROM pages ORDER BY page_title');
  const [parentMenus] = await pool.query(
    'SELECT id, page_title FROM page_menus ORDER BY page_title'
  );
  const groups = await listMenuGroups(pool);
  return { pages: pages || [], parentMenus: parentMenus || [], groups };
}

module.exports = {
  listPageMenusTree,
  listMenuGroups,
  createMenuGroup,
  deleteMenuGroup,
  renameMenuGroup,
  getPageMenuById,
  createPageMenu,
  updatePageMenu,
  deletePageMenu,
  updateGroupSort,
  updateFlatSort,
  getPageMenuFormOptions,
  fetchAllMenus,
};
