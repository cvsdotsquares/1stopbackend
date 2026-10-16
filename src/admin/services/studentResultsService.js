/**
 * Service for Student Update Results (F-073 / manageItinaryResult.php)
 * Table: itinary_result_options
 */

async function listResultOptions(pool, { search = '' } = {}) {
  let where = ' WHERE 1=1 ';
  const params = [];

  const trimmedSearch = String(search || '').trim();
  if (trimmedSearch) {
    where += ' AND `option` LIKE ? ';
    params.push(`%${trimmedSearch}%`);
  }

  const [rows] = await pool.query(
    `SELECT id, \`option\`, weight, created
     FROM itinary_result_options
     ${where}
     ORDER BY weight ASC, id ASC`,
    params
  );
  return (rows || []).map((row) => ({
    id: Number(row.id),
    option: String(row.option || ''),
    weight: Number(row.weight) || 0,
    created: row.created,
  }));
}

async function getResultOptionById(pool, optionId) {
  const id = Number(optionId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const [rows] = await pool.query(
    'SELECT id, `option`, weight, created FROM itinary_result_options WHERE id = ? LIMIT 1',
    [id]
  );
  if (!rows || rows.length === 0) return null;

  return {
    id: Number(rows[0].id),
    option: String(rows[0].option || ''),
    weight: Number(rows[0].weight) || 0,
    created: rows[0].created,
  };
}

async function createResultOption(pool, data) {
  const option = String(data.option || '').trim();

  if (!option) {
    return { ok: false, message: 'Result option text cannot be empty' };
  }

  // Check duplicate option text
  const [existing] = await pool.query(
    'SELECT id FROM itinary_result_options WHERE `option` = ? LIMIT 1',
    [option]
  );
  if (existing && existing.length > 0) {
    return { ok: false, message: 'A result option with this name already exists' };
  }

  let weight = data.weight !== undefined ? parseInt(data.weight, 10) : NaN;
  if (isNaN(weight) || weight <= 0) {
    const [[maxRow]] = await pool.query(
      'SELECT COALESCE(MAX(weight), 0) + 1 AS nextWeight FROM itinary_result_options'
    );
    weight = Number(maxRow?.nextWeight) || 1;
  }

  const [result] = await pool.query(
    'INSERT INTO itinary_result_options (`option`, weight) VALUES (?, ?)',
    [option, weight]
  );

  return {
    ok: true,
    message: 'Result option added successfully',
    id: result.insertId,
  };
}

async function updateResultOption(pool, optionId, data) {
  const id = Number(optionId);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, message: 'Invalid result option ID' };
  }

  const existing = await getResultOptionById(pool, id);
  if (!existing) {
    return { ok: false, message: 'Result option not found' };
  }

  const option = data.option !== undefined ? String(data.option || '').trim() : existing.option;
  const weight = data.weight !== undefined ? (parseInt(data.weight, 10) || 0) : existing.weight;

  if (!option) {
    return { ok: false, message: 'Result option text cannot be empty' };
  }

  // Check duplicate option text for other IDs
  const [dup] = await pool.query(
    'SELECT id FROM itinary_result_options WHERE `option` = ? AND id != ? LIMIT 1',
    [option, id]
  );
  if (dup && dup.length > 0) {
    return { ok: false, message: 'A result option with this name already exists' };
  }

  await pool.query(
    'UPDATE itinary_result_options SET `option` = ?, weight = ? WHERE id = ?',
    [option, weight, id]
  );

  return {
    ok: true,
    message: 'Result option updated successfully',
  };
}

async function deleteResultOption(pool, optionId) {
  const id = Number(optionId);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, message: 'Invalid result option ID' };
  }

  const existing = await getResultOptionById(pool, id);
  if (!existing) {
    return { ok: false, message: 'Result option not found' };
  }

  // Check if option is used in student daily reports
  const [[reportCountRow]] = await pool.query(
    'SELECT COUNT(*) AS total FROM student_daily_report WHERE report = ?',
    [id]
  );
  const inUseCount = Number(reportCountRow?.total) || 0;
  if (inUseCount > 0) {
    return {
      ok: false,
      message: `Cannot delete: this result option is referenced by ${inUseCount} student report(s).`,
    };
  }

  await pool.query('DELETE FROM itinary_result_options WHERE id = ?', [id]);

  return {
    ok: true,
    message: 'Result option deleted successfully',
  };
}

async function reorderResultOptions(pool, items) {
  if (!Array.isArray(items)) {
    return { ok: false, message: 'Invalid items list' };
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const id = Number(typeof item === 'object' ? item.id : item);
    const weight = typeof item === 'object' && typeof item.weight === 'number' ? item.weight : i + 1;
    if (id > 0) {
      await pool.query('UPDATE itinary_result_options SET weight = ? WHERE id = ?', [
        weight,
        id,
      ]);
    }
  }

  return {
    ok: true,
    message: 'Options reordered successfully',
  };
}

module.exports = {
  listResultOptions,
  getResultOptionById,
  createResultOption,
  updateResultOption,
  deleteResultOption,
  reorderResultOptions,
};
