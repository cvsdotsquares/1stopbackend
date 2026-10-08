function trim(value) {
  return value == null ? '' : String(value).trim();
}

const FOOTER_PAGE_ID = 73;

async function getFooterManagerState(pool) {
  const [pages] = await pool.query('SELECT * FROM pages WHERE id = ? LIMIT 1', [
    FOOTER_PAGE_ID,
  ]);
  const page = pages?.[0] || null;
  const [sections] = await pool.query(
    'SELECT * FROM footer_menu_section ORDER BY menu_weight ASC'
  );
  const [links] = await pool.query('SELECT * FROM footer_links ORDER BY weight ASC');
  const [allPages] = await pool.query('SELECT id, page_title FROM pages ORDER BY is_parent, weight');
  return {
    page,
    sections: sections || [],
    links: links || [],
    pages: allPages || [],
    footerPageId: FOOTER_PAGE_ID,
  };
}

async function updateFooterContent(pool, body) {
  const page_content = trim(body.page_content);
  const footer_left_content = trim(body.footer_left_content);
  if (!page_content || !footer_left_content) {
    return { ok: false, message: 'Required fields mark with * can not be left blank' };
  }
  await pool.query(
    'UPDATE pages SET page_content = ?, footer_left_content = ?, created = NOW() WHERE id = ?',
    [page_content, footer_left_content, FOOTER_PAGE_ID]
  );
  return { ok: true, message: 'Footer content edited successfully' };
}

async function saveMenuSection(pool, body) {
  const footer_menu_column = trim(body.footer_menu_column);
  const menu_weight = trim(body.menu_weight);
  const menu_status = trim(body.menu_status);
  const id = Number(body.id) || 0;
  if (!footer_menu_column || !menu_weight || menu_status === '') {
    return { ok: false, message: 'Required fields mark with * can not be left blank' };
  }
  if (id) {
    await pool.query(
      'UPDATE footer_menu_section SET footer_menu_column = ?, menu_weight = ?, menu_status = ? WHERE id = ?',
      [footer_menu_column, menu_weight, menu_status, id]
    );
    return { ok: true, message: 'Menu section edited successfully' };
  }
  await pool.query(
    'INSERT INTO footer_menu_section (footer_menu_column, menu_weight, menu_status) VALUES (?, ?, ?)',
    [footer_menu_column, menu_weight, menu_status]
  );
  return { ok: true, message: 'Menu section added successfully' };
}

async function deleteMenuSection(pool, id) {
  const [rows] = await pool.query('SELECT id FROM footer_menu_section WHERE id = ? LIMIT 1', [
    Number(id),
  ]);
  if (!rows?.length) {
    return { ok: false, message: 'Menu section not found to delete' };
  }
  await pool.query('DELETE FROM footer_menu_section WHERE id = ?', [Number(id)]);
  return { ok: true, message: 'Menu section deleted successfully' };
}

async function saveFooterLink(pool, body) {
  const footer_link_title = trim(body.footer_link_title);
  const navigation_type = trim(body.navigation_type);
  const footer_link_url = trim(body.footer_link_url);
  const weight = trim(body.weight);
  const menu_column = trim(body.menu_column);
  const id = Number(body.id) || 0;
  if (!footer_link_title || !navigation_type || !weight || !menu_column) {
    return { ok: false, message: 'Required fields mark with * can not be left blank' };
  }
  if (id) {
    await pool.query(
      `UPDATE footer_links SET footer_link_title = ?, navigation_type = ?, footer_link_url = ?, weight = ?, menu_column = ?
       WHERE id = ?`,
      [footer_link_title, navigation_type, footer_link_url, weight, menu_column, id]
    );
    return { ok: true, message: 'Link edited successfully' };
  }
  await pool.query(
    `INSERT INTO footer_links (footer_link_title, navigation_type, footer_link_url, weight, menu_column)
     VALUES (?, ?, ?, ?, ?)`,
    [footer_link_title, navigation_type, footer_link_url, weight, menu_column]
  );
  return { ok: true, message: 'Link added successfully' };
}

async function deleteFooterLink(pool, id) {
  const [rows] = await pool.query('SELECT id FROM footer_links WHERE id = ? LIMIT 1', [
    Number(id),
  ]);
  if (!rows?.length) {
    return { ok: false, message: 'Link not found to delete' };
  }
  await pool.query('DELETE FROM footer_links WHERE id = ?', [Number(id)]);
  return { ok: true, message: 'Link deleted successfully' };
}

module.exports = {
  getFooterManagerState,
  updateFooterContent,
  saveMenuSection,
  deleteMenuSection,
  saveFooterLink,
  deleteFooterLink,
};
