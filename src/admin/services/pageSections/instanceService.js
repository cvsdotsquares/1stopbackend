const { isSingleUse, newUuid, nowSql, SECTION_TITLES } = require('./constants');
const registry = require('./registry');
const { syncPageJunction } = require('./junctionSync');

async function listInstancesForPage(pool, pageId, dataType = 'page') {
  const [rows] = await pool.query(
    `SELECT * FROM cms_section_instances
     WHERE page_id = ? AND data_type = ? AND deleted_at IS NULL
     ORDER BY sort_order ASC, id ASC`,
    [pageId, dataType]
  );
  return rows || [];
}

async function getInstanceById(pool, instanceId, pageId) {
  const [rows] = await pool.query(
    `SELECT * FROM cms_section_instances
     WHERE id = ? AND page_id = ? AND deleted_at IS NULL LIMIT 1`,
    [instanceId, pageId]
  );
  return rows[0] || null;
}

async function hydrateInstance(pool, instance) {
  const handler = registry.getHandler(instance.section_type);
  let data = null;
  let loadError;
  try {
    data = await handler.load(pool, instance.content_id);
    if (!data) {
      loadError = `Content row ${instance.content_id} not found for ${instance.section_type}`;
    }
  } catch (err) {
    loadError = err.message;
  }
  return {
    id: instance.id,
    uuid: instance.uuid,
    type: instance.section_type,
    title: SECTION_TITLES[instance.section_type] || instance.section_type,
    content_id: instance.content_id,
    sort_order: Number(instance.sort_order) || 0,
    admin_label: instance.admin_label,
    status: instance.status,
    is_enabled: Number(instance.is_enabled) === 1,
    single_use: isSingleUse(instance.section_type),
    data,
    ...(loadError ? { load_error: loadError } : {}),
  };
}

async function addSection(pool, pageId, sectionType, dataType = 'page') {
  if (!registry.handlers[sectionType]) {
    return { ok: false, message: `Unknown section type: ${sectionType}` };
  }

  if (isSingleUse(sectionType)) {
    const [existing] = await pool.query(
      `SELECT id FROM cms_section_instances
       WHERE page_id = ? AND data_type = ? AND section_type = ? AND deleted_at IS NULL
       LIMIT 1`,
      [pageId, dataType, sectionType]
    );
    if (existing.length) {
      return { ok: false, message: 'This section type can only be added once' };
    }
  }

  const handler = registry.getHandler(sectionType);
  const pageType = dataType === 'location' ? 'location' : 'page';
  const contentId = await handler.createEmpty(pool, pageId, pageType);

  const [maxRows] = await pool.query(
    `SELECT COALESCE(MAX(sort_order), 0) AS max_sort
     FROM cms_section_instances
     WHERE page_id = ? AND data_type = ? AND deleted_at IS NULL`,
    [pageId, dataType]
  );
  const sortOrder = (Number(maxRows[0]?.max_sort) || 0) + 1;
  const stamp = nowSql();
  const uuid = newUuid();

  const [result] = await pool.query(
    `INSERT INTO cms_section_instances (
      uuid, page_id, data_type, section_type, content_id, sort_order,
      admin_label, status, is_enabled, legacy_junction_id, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'published', 1, NULL, ?, ?, NULL)`,
    [uuid, pageId, dataType, sectionType, contentId, sortOrder, stamp, stamp]
  );

  await pinHomeSliderFirst(pool, pageId, dataType);
  await syncPageJunction(pool, pageId, dataType);

  const instance = await getInstanceById(pool, result.insertId, pageId);
  const hydrated = await hydrateInstance(pool, instance);
  return { ok: true, data: hydrated };
}

async function reorderSections(pool, pageId, ordered, dataType = 'page') {
  const stamp = nowSql();
  for (const item of ordered || []) {
    const id = Number(item.id);
    const sortOrder = Number(item.sort_order);
    if (!Number.isFinite(id) || !Number.isFinite(sortOrder)) continue;
    await pool.query(
      `UPDATE cms_section_instances
       SET sort_order = ?, updated_at = ?
       WHERE id = ? AND page_id = ? AND data_type = ? AND deleted_at IS NULL`,
      [sortOrder, stamp, id, pageId, dataType]
    );
  }
  await pinHomeSliderFirst(pool, pageId, dataType);
  await syncPageJunction(pool, pageId, dataType);
  return { ok: true };
}

/** Enforce the hero invariant regardless of which client writes section order. */
async function pinHomeSliderFirst(pool, pageId, dataType = 'page') {
  const [rows] = await pool.query(
    `SELECT id, section_type
     FROM cms_section_instances
     WHERE page_id = ? AND data_type = ? AND deleted_at IS NULL
     ORDER BY sort_order ASC, id ASC`,
    [pageId, dataType]
  );
  const ordered = [
    ...rows.filter((row) => row.section_type === 'home_slider'),
    ...rows.filter((row) => row.section_type !== 'home_slider'),
  ];
  const stamp = nowSql();
  for (let index = 0; index < ordered.length; index += 1) {
    await pool.query(
      `UPDATE cms_section_instances
       SET sort_order = ?, updated_at = ?
       WHERE id = ? AND page_id = ? AND data_type = ?`,
      [index + 1, stamp, ordered[index].id, pageId, dataType]
    );
  }
}

async function patchInstance(pool, pageId, instanceId, patch = {}) {
  const instance = await getInstanceById(pool, instanceId, pageId);
  if (!instance) {
    return { ok: false, message: 'Section instance not found' };
  }

  const updates = [];
  const params = [];
  if (Object.prototype.hasOwnProperty.call(patch, 'admin_label')) {
    updates.push('admin_label = ?');
    params.push(patch.admin_label);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
    if (!['draft', 'published'].includes(patch.status)) {
      return { ok: false, message: 'Invalid status' };
    }
    updates.push('status = ?');
    params.push(patch.status);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'is_enabled')) {
    updates.push('is_enabled = ?');
    params.push(patch.is_enabled ? 1 : 0);
  }
  if (!updates.length) {
    return { ok: false, message: 'No fields to update' };
  }
  updates.push('updated_at = ?');
  params.push(nowSql());
  params.push(instanceId, pageId);

  await pool.query(
    `UPDATE cms_section_instances SET ${updates.join(', ')}
     WHERE id = ? AND page_id = ? AND deleted_at IS NULL`,
    params
  );
  await syncPageJunction(pool, pageId, instance.data_type);
  const updated = await getInstanceById(pool, instanceId, pageId);
  return { ok: true, data: await hydrateInstance(pool, updated) };
}

async function softDeleteInstance(pool, pageId, instanceId) {
  const instance = await getInstanceById(pool, instanceId, pageId);
  if (!instance) {
    return { ok: false, message: 'Section instance not found' };
  }
  await pool.query(
    `UPDATE cms_section_instances SET deleted_at = ?, updated_at = ?
     WHERE id = ? AND page_id = ?`,
    [nowSql(), nowSql(), instanceId, pageId]
  );
  await syncPageJunction(pool, pageId, instance.data_type);
  return { ok: true, message: 'Section removed' };
}

async function restoreInstance(pool, pageId, instanceId) {
  const [rows] = await pool.query(
    `SELECT * FROM cms_section_instances WHERE id = ? AND page_id = ? LIMIT 1`,
    [instanceId, pageId]
  );
  const instance = rows[0];
  if (!instance || !instance.deleted_at) {
    return { ok: false, message: 'Section not found to restore' };
  }
  if (isSingleUse(instance.section_type)) {
    const [existing] = await pool.query(
      `SELECT id FROM cms_section_instances
       WHERE page_id = ? AND data_type = ? AND section_type = ? AND deleted_at IS NULL AND id != ?
       LIMIT 1`,
      [pageId, instance.data_type || 'page', instance.section_type, instanceId]
    );
    if (existing.length) {
      return { ok: false, message: 'This section type can only be added once' };
    }
  }
  await pool.query(
    `UPDATE cms_section_instances SET deleted_at = NULL, updated_at = ? WHERE id = ?`,
    [nowSql(), instanceId]
  );
  await pinHomeSliderFirst(pool, pageId, instance.data_type);
  await syncPageJunction(pool, pageId, instance.data_type);
  const updated = await getInstanceById(pool, instanceId, pageId);
  return { ok: true, data: await hydrateInstance(pool, updated) };
}

async function purgeInstance(pool, pageId, instanceId) {
  const [rows] = await pool.query(
    `SELECT * FROM cms_section_instances WHERE id = ? AND page_id = ? LIMIT 1`,
    [instanceId, pageId]
  );
  const instance = rows[0];
  if (!instance) {
    return { ok: false, message: 'Section instance not found' };
  }
  const handler = registry.getHandler(instance.section_type);
  await handler.remove(pool, instance.content_id);
  if (instance.legacy_junction_id) {
    await pool.query('DELETE FROM page_junction WHERE id = ?', [
      instance.legacy_junction_id,
    ]);
  }
  await pool.query('DELETE FROM cms_section_instances WHERE id = ?', [instanceId]);
  await syncPageJunction(pool, pageId, instance.data_type);
  return { ok: true, message: 'Section permanently deleted' };
}

async function removeNestedItem(pool, pageId, instanceId, itemId) {
  const instance = await getInstanceById(pool, instanceId, pageId);
  if (!instance) {
    return { ok: false, message: 'Section instance not found' };
  }
  const handler = registry.getHandler(instance.section_type);
  if (!handler.removeItem) {
    return { ok: false, message: 'This section has no nested items' };
  }
  await handler.removeItem(pool, instance.content_id, itemId);
  return { ok: true };
}

module.exports = {
  listInstancesForPage,
  getInstanceById,
  hydrateInstance,
  addSection,
  reorderSections,
  pinHomeSliderFirst,
  patchInstance,
  softDeleteInstance,
  restoreInstance,
  purgeInstance,
  removeNestedItem,
};
