/**
 * Own-vehicle option on course_events. Some DBs use vehicle_type_own; older schemas
 * only expose own_* pricing columns.
 */

let courseEventsHasOwnVehicleColumn = null;

async function courseEventsHasOwnVehicleFlag(pool) {
  if (courseEventsHasOwnVehicleColumn != null) {
    return courseEventsHasOwnVehicleColumn;
  }
  try {
    const [rows] = await pool.query(
      `SHOW COLUMNS FROM course_events LIKE 'vehicle_type_own'`
    );
    courseEventsHasOwnVehicleColumn = rows.length > 0;
  } catch {
    courseEventsHasOwnVehicleColumn = false;
  }
  return courseEventsHasOwnVehicleColumn;
}

function inferOwnVehicleEnabled(row) {
  if (!row) return 0;
  if (row.vehicle_type_own != null && row.vehicle_type_own !== '') {
    return Number(row.vehicle_type_own) > 0 ? 1 : 0;
  }
  const fromPricing =
    Number(row.own_one_off_price) > 0 ||
    Number(row.own_deposit_price) > 0 ||
    Number(row.own_total_price) > 0;
  return fromPricing ? 1 : 0;
}

function attachInferredOwnVehicle(row) {
  if (!row) return row;
  return { ...row, vehicle_type_own: inferOwnVehicleEnabled(row) };
}

module.exports = {
  courseEventsHasOwnVehicleFlag,
  inferOwnVehicleEnabled,
  attachInferredOwnVehicle,
};
