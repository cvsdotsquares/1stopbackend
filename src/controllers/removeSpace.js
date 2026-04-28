const fs = require('node:fs');
const path = require('node:path');

const LOG_FILE = path.join(__dirname, '../../restapi/booking/remove_space.txt');

const ensureLogDir = () => {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const logMessage = (message) => {
  ensureLogDir();
  const timestamp = new Date().toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).replace(',', '');

  fs.appendFileSync(LOG_FILE, `[${timestamp}] ${message}\n`);
};

const removeSpaceInDb = async (pool, eventId, lockId) => {
  const conn = await pool.getConnection();
  try {
    console.log(`Attempting to remove space: eventId=${eventId}, lockId=${lockId}`);
    await conn.beginTransaction();

    const [parentRows] = await conn.query(
      'SELECT id, parent FROM course_events WHERE parent = (SELECT parent FROM course_events WHERE id = ?)',
      [eventId]
    );

    if (!parentRows || parentRows.length === 0) {
      await conn.rollback();
      return 'event_not_exists';
    }

    const parentEvent = parentRows[0];

    const [lockRows] = await conn.query(
      'SELECT id FROM lock_bookings WHERE id = ?',
      [lockId]
    );

    if (!lockRows || lockRows.length === 0) {
      await conn.rollback();
      return 'lock_id_not_exists';
    }

    const [deleteResult] = await conn.query(
      'DELETE FROM lock_bookings WHERE id = ?',
      [lockId]
    );

    if (!deleteResult || deleteResult.affectedRows === 0) {
      await conn.rollback();
      return 'lock_id_not_exists';
    }

    const [updateResult] = await conn.query(
      'UPDATE course_events SET current_locks = current_locks - 1 WHERE id = ?',
      [parentEvent.id]
    );

    if (!updateResult || updateResult.affectedRows === 0) {
      await conn.rollback();
      return 'event_not_update';
    }

    await conn.commit();
    return 'success';
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

const removeSpace = (pool) => async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: `Method "${req.method}" not allowed.` });
  }

  const courseEventId = req.body?.course_event_id;
  const lockId = req.body?.lock_id ?? req.body?.space_hold_id;

  if (!courseEventId) {
    return res.status(404).json({ message: ['Course event id is required.'] });
  }

  if (!lockId) {
    return res.status(404).json({ message: ['Hold space id is required.'] });
  }

  if (!courseEventId || !lockId) {
    return res.status(404).json({ message: 'Course event id not found.' });
  }

  try {
    const status = await removeSpaceInDb(pool, courseEventId, lockId);

    if (status === 'success') {
      logMessage('success::200 -- Reserved sapce is removed');
      return res.status(200).json({ message: 'Reserved sapce is removed.' });
    }

    if (status === 'event_not_update') {
      logMessage('event_not_update::Error:400 -- Course event is not exists');
      return res.status(400).json({ message: 'Course event is not exists.' });
    }

    if (status === 'lock_id_not_exists') {
      logMessage('lock_id_not_exists::Error:400 -- Hold space is not exists');
      return res.status(400).json({ message: 'Hold space is not exists.' });
    }

    if (status === 'event_not_exists') {
      logMessage('event_not_exists::Error:400 -- Course event is not exists');
      return res.status(400).json({ message: 'Course event is not exists.' });
    }

    logMessage('event_not_exists::Error:400 -- Course event is not exists');
    return res.status(400).json({ message: 'Course event is not exists.' });
  } catch (err) {
    logMessage(`error::500 -- ${err.message}`);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = removeSpace;
