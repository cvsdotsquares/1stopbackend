const RECORDS_PER_PAGE = 10;

const COURSE_STATUS_LABELS = ['Off', 'Admin & Customer', 'Admin'];

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function getStatusLabel(status) {
  const index = Number(status);
  return COURSE_STATUS_LABELS[index] ?? COURSE_STATUS_LABELS[0];
}

function mapCourseRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    course_name: row.course_name,
    course_abb: row.course_abb,
    description: row.description,
    email_content: row.email_content,
    send_feedback_mail: Number(row.send_feedback_mail) || 0,
    feedback_content: row.feedback_content,
    reminder_content: row.reminder_content,
    course_bullet_points: row.course_bullet_points,
    cancel_price: row.cancel_price,
    cancel_days: row.cancel_days,
    deposit_days: row.deposit_days,
    dsa_fees: row.dsa_fees,
    default_booking_limit: row.default_booking_limit,
    default_manual_vehicle: row.default_manual_vehicle,
    default_automatic_vehicle: row.default_automatic_vehicle,
    default_start_time: row.default_start_time,
    default_end_time: row.default_end_time,
    status: String(row.status ?? '0'),
    status_label: getStatusLabel(row.status),
    is_cbt: Number(row.is_cbt) || 0,
    dvsa_email: row.dvsa_email,
    created: row.created,
    modified: row.modified,
    isDeleted: row.isDeleted,
  };
}

function buildListWhere(searchterm) {
  let where = " WHERE courses.id != '' AND courses.isDeleted = '0' ";
  const params = [];

  const nameScr = trim(searchterm?.name_scr);
  if (nameScr) {
    where += ' AND courses.course_name LIKE ?';
    params.push(`%${nameScr}%`);
  }

  return { where, params };
}

async function listCourses(pool, { page = 1, searchterm = {} } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const { where, params } = buildListWhere(searchterm);
  const offset = (pageNum - 1) * RECORDS_PER_PAGE;

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM courses ${where}`,
    params
  );
  const total = Number(countRows?.[0]?.total) || 0;

  const [rows] = await pool.query(
    `SELECT * FROM courses ${where} ORDER BY courses.course_name ASC LIMIT ?, ?`,
    [...params, offset, RECORDS_PER_PAGE]
  );

  return {
    items: (rows || []).map(mapCourseRow),
    pagination: {
      page: pageNum,
      perPage: RECORDS_PER_PAGE,
      total,
      totalPages: Math.max(1, Math.ceil(total / RECORDS_PER_PAGE)),
    },
    filters: {
      name_scr: trim(searchterm?.name_scr),
      sort: trim(searchterm?.sort),
    },
    statusOptions: COURSE_STATUS_LABELS.map((label, value) => ({
      value: String(value),
      label,
    })),
  };
}

async function getCourseById(pool, id) {
  const [rows] = await pool.query('SELECT * FROM courses WHERE id = ? LIMIT 1', [
    id,
  ]);
  return mapCourseRow(rows?.[0]);
}

async function courseExistsById(pool, id) {
  const [rows] = await pool.query('SELECT id FROM courses WHERE id = ? LIMIT 1', [
    id,
  ]);
  return Boolean(rows?.length);
}

async function courseExistsByName(pool, name) {
  const [rows] = await pool.query(
    'SELECT id FROM courses WHERE course_name = ? LIMIT 1',
    [name]
  );
  return Boolean(rows?.length);
}

async function otherCourseExistsByName(pool, name, id) {
  const [rows] = await pool.query(
    'SELECT id FROM courses WHERE course_name = ? AND id != ? LIMIT 1',
    [name, id]
  );
  return Boolean(rows?.length);
}

function validateTimes(defaultStartTime, defaultEndTime) {
  const startRaw = trim(defaultStartTime).replace(':', '');
  const endRaw = trim(defaultEndTime).replace(':', '');

  if (!startRaw || !endRaw) {
    return {
      ok: false,
      message: 'Please fill all the start and end times',
    };
  }

  if (Number.parseInt(startRaw, 10) >= Number.parseInt(endRaw, 10)) {
    return {
      ok: false,
      message: 'End time cannot be Less than or equal to Start time',
    };
  }

  return { ok: true };
}

function getRequiredFields(isEdit) {
  const fields = [
    'course_name',
    'description',
    'email_content',
    'reminder_content',
    'cancel_price',
    'cancel_days',
    'deposit_days',
    'dsa_fees',
    'status',
    'default_booking_limit',
    'default_manual_vehicle',
    'default_automatic_vehicle',
    'default_start_time',
    'default_end_time',
    'course_bullet_points',
  ];

  if (isEdit) {
    fields.unshift('id');
  }

  return fields;
}

function validateCourseBody(body, isEdit = false) {
  const requiredFields = getRequiredFields(isEdit);
  const isCbt = String(body.is_cbt ?? '0') === '1';
  const sendFeedbackMail = String(body.send_feedback_mail ?? '0') === '1';

  if (isCbt) {
    requiredFields.push('dvsa_email');
  }
  if (sendFeedbackMail) {
    requiredFields.push('feedback_content');
  }

  for (const field of requiredFields) {
    if (!trim(body[field])) {
      return {
        ok: false,
        message: 'Required fields mark with * can not be left blank',
      };
    }
  }

  const timeValidation = validateTimes(
    body.default_start_time,
    body.default_end_time
  );
  if (!timeValidation.ok) {
    return timeValidation;
  }

  const status = String(body.status ?? '');
  if (!['0', '1', '2'].includes(status)) {
    return {
      ok: false,
      message: 'Required fields mark with * can not be left blank',
    };
  }

  return {
    ok: true,
    data: {
      id: trim(body.id) || undefined,
      course_name: trim(body.course_name),
      course_abb: trim(body.course_abb),
      description: trim(body.description),
      email_content: trim(body.email_content),
      send_feedback_mail: sendFeedbackMail ? 1 : 0,
      feedback_content: sendFeedbackMail
        ? trim(body.feedback_content)
        : isEdit
          ? trim(body.feedback_content)
          : '',
      reminder_content: trim(body.reminder_content),
      course_bullet_points: trim(body.course_bullet_points),
      cancel_price: trim(body.cancel_price),
      cancel_days: trim(body.cancel_days),
      deposit_days: trim(body.deposit_days),
      dsa_fees: trim(body.dsa_fees),
      default_booking_limit: trim(body.default_booking_limit),
      default_manual_vehicle: trim(body.default_manual_vehicle),
      default_automatic_vehicle: trim(body.default_automatic_vehicle),
      default_start_time: trim(body.default_start_time),
      default_end_time: trim(body.default_end_time),
      status,
      is_cbt: isCbt ? 1 : 0,
      dvsa_email: isCbt ? trim(body.dvsa_email) : '',
    },
  };
}

async function createCourse(pool, body) {
  const validation = validateCourseBody(body, false);
  if (!validation.ok) {
    return validation;
  }

  const data = validation.data;
  const exists = await courseExistsByName(pool, data.course_name);
  if (exists) {
    return {
      ok: false,
      message: 'Course already exits with same course name',
    };
  }

  const created = formatTimestamp();

  const [result] = await pool.query(
    `INSERT INTO courses (
      course_name, description, email_content, send_feedback_mail, feedback_content,
      reminder_content, cancel_price, cancel_days, dsa_fees, status, created,
      deposit_days, default_booking_limit, default_manual_vehicle,
      default_automatic_vehicle, default_start_time, default_end_time,
      course_abb, is_cbt, dvsa_email, course_bullet_points
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.course_name,
      data.description,
      data.email_content,
      data.send_feedback_mail,
      data.feedback_content,
      data.reminder_content,
      data.cancel_price,
      data.cancel_days,
      data.dsa_fees,
      data.status,
      created,
      data.deposit_days,
      data.default_booking_limit,
      data.default_manual_vehicle,
      data.default_automatic_vehicle,
      data.default_start_time,
      data.default_end_time,
      data.course_abb,
      data.is_cbt,
      data.dvsa_email,
      data.course_bullet_points,
    ]
  );

  if (!result?.insertId) {
    return { ok: false, message: 'Error in adding course' };
  }

  return {
    ok: true,
    message: 'Course added successfully',
    data: { id: result.insertId },
  };
}

async function updateCourse(pool, id, body) {
  const bodyWithId = { ...body, id: String(id) };
  const validation = validateCourseBody(bodyWithId, true);
  if (!validation.ok) {
    return validation;
  }

  const existing = await getCourseById(pool, id);
  if (!existing) {
    return { ok: false, message: 'Course not found to edit' };
  }

  const data = validation.data;
  const duplicate = await otherCourseExistsByName(pool, data.course_name, id);
  if (duplicate) {
    return {
      ok: false,
      message: 'Another course already exits with same course name',
    };
  }

  const modified = formatTimestamp();

  const [result] = await pool.query(
    `UPDATE courses SET
      course_name = ?, description = ?, email_content = ?, feedback_content = ?,
      reminder_content = ?, cancel_price = ?, cancel_days = ?, dsa_fees = ?,
      status = ?, modified = ?, deposit_days = ?, default_booking_limit = ?,
      default_manual_vehicle = ?, default_automatic_vehicle = ?,
      default_start_time = ?, default_end_time = ?, course_abb = ?, is_cbt = ?,
      dvsa_email = ?, send_feedback_mail = ?, course_bullet_points = ?
    WHERE id = ?`,
    [
      data.course_name,
      data.description,
      data.email_content,
      data.feedback_content,
      data.reminder_content,
      data.cancel_price,
      data.cancel_days,
      data.dsa_fees,
      data.status,
      modified,
      data.deposit_days,
      data.default_booking_limit,
      data.default_manual_vehicle,
      data.default_automatic_vehicle,
      data.default_start_time,
      data.default_end_time,
      data.course_abb,
      data.is_cbt,
      data.dvsa_email,
      data.send_feedback_mail,
      data.course_bullet_points,
      id,
    ]
  );

  if (!result?.affectedRows) {
    return { ok: false, message: 'Error in updating course' };
  }

  return { ok: true, message: 'Course edited successfully' };
}

async function updateCourseStatus(pool, id, status) {
  const statusValue = String(status ?? '');
  if (!['0', '1', '2'].includes(statusValue)) {
    return { ok: false, message: 'Error in change status' };
  }

  const exists = await courseExistsById(pool, id);
  if (!exists) {
    return { ok: false, message: 'Course not found to delete' };
  }

  const [result] = await pool.query('UPDATE courses SET status = ? WHERE id = ?', [
    statusValue,
    id,
  ]);

  if (!result?.affectedRows) {
    return { ok: false, message: 'Error in change status' };
  }

  return { ok: true, message: 'Course status changed successfully' };
}

async function softDeleteCourse(pool, id) {
  const exists = await courseExistsById(pool, id);
  if (!exists) {
    return { ok: false, message: 'Course not found to delete' };
  }

  const [result] = await pool.query(
    "UPDATE courses SET isDeleted = '1' WHERE id = ?",
    [id]
  );

  if (!result?.affectedRows) {
    return { ok: false, message: 'Error in deleting course' };
  }

  return { ok: true, message: 'Course deleted successfully' };
}

module.exports = {
  RECORDS_PER_PAGE,
  COURSE_STATUS_LABELS,
  listCourses,
  getCourseById,
  createCourse,
  updateCourse,
  updateCourseStatus,
  softDeleteCourse,
};
