/**
 * Port of Vehicle::setVehicleColors() and updateVehicleIssueStatus() from vehicles.class.php
 */

function nowMysql() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function toMysqlDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())} ${p(value.getHours())}:${p(value.getMinutes())}:${p(value.getSeconds())}`;
  }
  const s = String(value).trim();
  if (!s || s.startsWith('0000-00-00')) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s} 00:00:00`;
  return s.slice(0, 19);
}

function addDaysMysql(dateStr, days) {
  const base = toMysqlDateTime(dateStr);
  if (!base) return null;
  const d = new Date(base.replace(' ', 'T'));
  d.setDate(d.getDate() + days);
  return toMysqlDateTime(d);
}

function addYearsMysql(dateStr, years) {
  const base = toMysqlDateTime(dateStr);
  if (!base) return null;
  const d = new Date(base.replace(' ', 'T'));
  d.setFullYear(d.getFullYear() + years);
  return toMysqlDateTime(d);
}

function computeServiceColor(vehicleData, currTime = nowMysql()) {
  let mileageDiff =
    Number(vehicleData.mileage_last_service || 0) -
    Number(vehicleData.mileage || 0);
  if (mileageDiff < 0) mileageDiff = -mileageDiff;
  if (mileageDiff >= Number(vehicleData.mileage_service_interval || 0)) {
    return 'red';
  }
  const plusOneYear = addYearsMysql(vehicleData.last_service_date, 1);
  if (plusOneYear && currTime > plusOneYear) return 'yellow';
  return 'green';
}

async function setVehicleColors(pool, id, mode = 'edit') {
  const vehicleId = Number(id);
  if (!vehicleId) return;

  const [rows] = await pool.query('SELECT * FROM vehicles WHERE id = ?', [
    vehicleId,
  ]);
  const vehicleData = rows[0];
  if (!vehicleData) return;

  const currTime = nowMysql();
  const issueColor =
    mode === 'add' ? 'green' : String(vehicleData.issue_color || 'green');

  let motColor = 'green';
  const motExpiry = toMysqlDateTime(vehicleData.mot_expiry_date);
  if (motExpiry) {
    const motWarn = addDaysMysql(motExpiry, -30);
    if (currTime >= motExpiry) motColor = 'red';
    else if (motWarn && currTime > motWarn && currTime < motExpiry) {
      motColor = 'yellow';
    } else motColor = 'green';
  }

  let roadTaxColor = 'none';
  if (vehicleData.sorn_exempt_option === 'sorn') {
    roadTaxColor = 'blue';
  } else if (vehicleData.sorn_exempt_option === 'exempt') {
    roadTaxColor = 'green';
  } else if (
    vehicleData.sorn_exempt_option === 'road_tax' &&
    vehicleData.road_tax_due_date
  ) {
    const taxDue = toMysqlDateTime(vehicleData.road_tax_due_date);
    if (taxDue) {
      const taxWarn = addDaysMysql(taxDue, -30);
      if (currTime >= taxDue) roadTaxColor = 'red';
      else if (taxWarn && currTime > taxWarn && currTime < taxDue) {
        roadTaxColor = 'yellow';
      } else roadTaxColor = 'green';
    }
  }

  const serviceColor = computeServiceColor(vehicleData, currTime);

  await pool.query(
    `UPDATE vehicles SET issue_color = ?, mot_color = ?, road_tax_color = ?, service_color = ? WHERE id = ?`,
    [issueColor, motColor, roadTaxColor, serviceColor, vehicleId]
  );
}

async function updateVehicleIssueStatus(pool, vid) {
  const vehicleId = Number(vid);
  if (!vehicleId) return;

  const [rows] = await pool.query(
    'SELECT issue_status FROM vehicle_logs WHERE vehicle_id = ? GROUP BY issue_status',
    [vehicleId]
  );
  const statuses = (rows || []).map((r) => String(r.issue_status || ''));
  let issueColor = 'green';
  if (statuses.includes('red')) issueColor = 'red';
  else if (statuses.includes('purple')) issueColor = 'purple';
  else if (statuses.includes('yellow')) issueColor = 'yellow';

  await pool.query('UPDATE vehicles SET issue_color = ? WHERE id = ?', [
    issueColor,
    vehicleId,
  ]);
}

module.exports = {
  nowMysql,
  computeServiceColor,
  setVehicleColors,
  updateVehicleIssueStatus,
};
