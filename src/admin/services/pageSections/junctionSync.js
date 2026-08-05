/**
 * Outbound sync: cms_section_instances → page_junction for public cmspages.js
 */
async function syncPageJunction(pool, pageId, dataType = 'page') {
  const [instances] = await pool.query(
    `SELECT id, section_type, content_id, sort_order, legacy_junction_id
     FROM cms_section_instances
     WHERE page_id = ? AND data_type = ?
       AND deleted_at IS NULL
       AND is_enabled = 1
       AND status = 'published'
     ORDER BY sort_order ASC, id ASC`,
    [pageId, dataType]
  );

  const [existing] = await pool.query(
    `SELECT id FROM page_junction WHERE data_id = ? AND data_type = ?`,
    [pageId, dataType]
  );
  const existingIds = new Set(existing.map((r) => Number(r.id)));
  const keepIds = new Set();

  for (const inst of instances) {
    const legacyId = Number(inst.legacy_junction_id);
    if (legacyId && existingIds.has(legacyId)) {
      await pool.query(
        `UPDATE page_junction
         SET section_data = ?, section_id = ?, sort_order = ?
         WHERE id = ?`,
        [inst.section_type, inst.content_id, Number(inst.sort_order) || 0, legacyId]
      );
      keepIds.add(legacyId);
    } else {
      const [result] = await pool.query(
        `INSERT INTO page_junction (data_id, data_type, section_data, section_id, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
        [
          pageId,
          dataType,
          inst.section_type,
          inst.content_id,
          Number(inst.sort_order) || 0,
        ]
      );
      keepIds.add(result.insertId);
      await pool.query(
        `UPDATE cms_section_instances SET legacy_junction_id = ? WHERE id = ?`,
        [result.insertId, inst.id]
      );
    }
  }

  for (const id of existingIds) {
    if (!keepIds.has(id)) {
      await pool.query('DELETE FROM page_junction WHERE id = ?', [id]);
    }
  }
}

module.exports = {
  syncPageJunction,
};
