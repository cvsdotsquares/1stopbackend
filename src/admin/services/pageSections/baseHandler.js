const { trim, nowSql } = require('./constants');

async function selectOne(pool, sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows[0] || null;
}

async function selectAll(pool, sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows || [];
}

/**
 * Generic parent-row section with optional children.
 */
function createTableHandler({
  table,
  pageIdColumn = 'page_id',
  pageTypeColumn = 'page_type',
  defaults = {},
  mapRow = (row) => row,
  children = null,
}) {
  return {
    async load(pool, contentId) {
      const row = await selectOne(pool, `SELECT * FROM \`${table}\` WHERE id = ? LIMIT 1`, [
        contentId,
      ]);
      if (!row) return null;
      const data = mapRow(row);
      if (children) {
        data[children.key] = await selectAll(
          pool,
          `SELECT * FROM \`${children.table}\` WHERE \`${children.fk}\` = ? ORDER BY ${children.orderBy || 'id'} ASC`,
          [contentId]
        );
      }
      return data;
    },

    async createEmpty(pool, pageId, pageType = 'page') {
      const fields = { ...defaults };
      const cols = [pageIdColumn];
      const vals = [pageId];
      if (pageTypeColumn) {
        cols.push(pageTypeColumn);
        vals.push(pageType === 'location' ? 'location' : 'page');
      }
      for (const [key, value] of Object.entries(fields)) {
        cols.push(key);
        vals.push(value);
      }
      const placeholders = cols.map(() => '?').join(', ');
      const [result] = await pool.query(
        `INSERT INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(', ')}) VALUES (${placeholders})`,
        vals
      );
      return result.insertId;
    },

    async save(pool, contentId, payload = {}) {
      const row = await selectOne(pool, `SELECT * FROM \`${table}\` WHERE id = ? LIMIT 1`, [
        contentId,
      ]);
      if (!row) {
        return { ok: false, message: 'Section content not found' };
      }

      const updates = [];
      const params = [];
      for (const key of Object.keys(row)) {
        if (key === 'id' || key === pageIdColumn || key === pageTypeColumn) continue;
        if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
        updates.push(`\`${key}\` = ?`);
        params.push(payload[key]);
      }
      if (updates.length) {
        params.push(contentId);
        await pool.query(
          `UPDATE \`${table}\` SET ${updates.join(', ')} WHERE id = ?`,
          params
        );
      }

      if (children && Array.isArray(payload[children.key])) {
        await syncChildren(pool, contentId, payload[children.key], children);
      }

      return { ok: true };
    },

    async remove(pool, contentId) {
      if (children) {
        await pool.query(`DELETE FROM \`${children.table}\` WHERE \`${children.fk}\` = ?`, [
          contentId,
        ]);
      }
      await pool.query(`DELETE FROM \`${table}\` WHERE id = ?`, [contentId]);
      return { ok: true };
    },

    async removeItem(pool, contentId, itemId) {
      if (!children) {
        return { ok: false, message: 'No nested items' };
      }
      await pool.query(
        `DELETE FROM \`${children.table}\` WHERE id = ? AND \`${children.fk}\` = ?`,
        [itemId, contentId]
      );
      return { ok: true };
    },
  };
}

async function syncChildren(pool, parentId, items, children) {
  const existing = await selectAll(
    pool,
    `SELECT id FROM \`${children.table}\` WHERE \`${children.fk}\` = ?`,
    [parentId]
  );
  const existingIds = new Set(existing.map((r) => Number(r.id)));
  const keepIds = new Set();

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i] || {};
    const itemId = Number(item.id);
    const fields = { ...(children.defaults || {}) };
    for (const col of children.columns) {
      if (Object.prototype.hasOwnProperty.call(item, col)) {
        fields[col] = item[col];
      }
    }
    if (children.orderColumn) {
      // Array order from the editor is authoritative (up/down buttons).
      fields[children.orderColumn] = i + 1;
    }

    if (itemId && existingIds.has(itemId)) {
      keepIds.add(itemId);
      const sets = Object.keys(fields).map((k) => `\`${k}\` = ?`);
      const vals = Object.values(fields);
      vals.push(itemId, parentId);
      await pool.query(
        `UPDATE \`${children.table}\` SET ${sets.join(', ')} WHERE id = ? AND \`${children.fk}\` = ?`,
        vals
      );
    } else {
      const cols = [children.fk, ...Object.keys(fields)];
      const vals = [parentId, ...Object.values(fields)];
      const [result] = await pool.query(
        `INSERT INTO \`${children.table}\` (${cols.map((c) => `\`${c}\``).join(', ')}) VALUES (${cols
          .map(() => '?')
          .join(', ')})`,
        vals
      );
      keepIds.add(result.insertId);
    }
  }

  for (const id of existingIds) {
    if (!keepIds.has(id)) {
      await pool.query(`DELETE FROM \`${children.table}\` WHERE id = ?`, [id]);
    }
  }
}

module.exports = {
  selectOne,
  selectAll,
  createTableHandler,
  syncChildren,
  trim,
  nowSql,
};
