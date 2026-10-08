function trim(value) {
  return value == null ? '' : String(value).trim();
}

async function computeLegacyDefaults(pool) {
  const [[locRow]] = await pool.query(
    "SELECT COUNT(id) AS c FROM locations WHERE status = '1'"
  );
  const [[instRow]] = await pool.query(
    "SELECT COUNT(id) AS c FROM itineraries WHERE status = '1'"
  );
  const [[studentRow]] = await pool.query(
    "SELECT COUNT(id) AS c FROM student_daily_report WHERE report = '1'"
  );
  const [[passRow]] = await pool.query(`
    SELECT ROUND(
      (SUM(CASE WHEN report = 1 THEN 1 ELSE 0 END) / COUNT(*)) * 100,
      2
    ) AS PassRate
    FROM student_daily_report
  `);

  return {
    taining_centers: Number(locRow?.c) || 0,
    qualified_instructors: Number(instRow?.c) || 0,
    student_tainined: Number(studentRow?.c) || 0,
    passing_rate: Number(passRow?.PassRate) || 0,
  };
}

async function getTrainingData(pool) {
  const [rows] = await pool.query('SELECT * FROM training_data LIMIT 1');
  if (rows?.length) {
    return rows[0];
  }
  return computeLegacyDefaults(pool);
}

async function updateTrainingData(pool, body) {
  const training_centers = parseInt(trim(body.training_centers), 10);
  const qualified_instructors = parseInt(trim(body.qualified_instructors), 10);
  const students_trained = parseInt(trim(body.students_trained), 10);
  const pass_rate = parseFloat(trim(body.pass_rate));

  if (
    !Number.isFinite(training_centers) ||
    !Number.isFinite(qualified_instructors) ||
    !Number.isFinite(students_trained) ||
    !Number.isFinite(pass_rate)
  ) {
    return { ok: false, message: 'Required fields can not be left blank' };
  }

  const [existing] = await pool.query('SELECT id FROM training_data LIMIT 1');
  if (existing?.length) {
    await pool.query(
      `UPDATE training_data SET
        taining_centers = ?,
        qualified_instructors = ?,
        student_tainined = ?,
        passing_rate = ?,
        updated = NOW()
       WHERE id = ?`,
      [
        training_centers,
        qualified_instructors,
        students_trained,
        pass_rate,
        existing[0].id,
      ]
    );
  } else {
    await pool.query(
      `INSERT INTO training_data
        (taining_centers, qualified_instructors, student_tainined, passing_rate, updated)
       VALUES (?, ?, ?, ?, NOW())`,
      [training_centers, qualified_instructors, students_trained, pass_rate]
    );
  }

  return { ok: true, message: 'Training data updated successfully' };
}

module.exports = {
  getTrainingData,
  updateTrainingData,
};
