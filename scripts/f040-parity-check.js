/**
 * F-040 parity: compare legacy schedule SQL row set vs vehiclesService.getVehicleSchedule
 */
require('dotenv').config({ path: '.env.local' });
const mysql = require('mysql2/promise');
const { getVehicleSchedule } = require('../src/admin/services/vehiclesService');

const JOINS = `
  FROM vehicles
  LEFT JOIN vehicle_fleet_settings AS mm ON (
    mm.setting_type = 'make_model' AND mm.setting_name = 'option_name' AND mm.id = vehicles.make_model_id
  )
  LEFT JOIN vehicle_fleet_settings AS en ON (
    en.setting_type = 'engine_size' AND en.setting_name = 'option_name' AND en.id = vehicles.engine_size_id
  )
  LEFT JOIN vehicle_fleet_settings AS tran ON (
    tran.setting_type = 'transmission' AND tran.setting_name = 'option_name' AND tran.id = vehicles.transmission_id
  )
  LEFT JOIN locations AS loc ON loc.id = vehicles.location_id
`;

function legacyEligible(row) {
  return (
    row.transmission_id &&
    row.make_model_id &&
    row.engine_size_id
  );
}

function flattenGroups(groups) {
  const ids = [];
  for (const g of groups) {
    for (const t of g.transmission) {
      for (const m of t.make_model) {
        for (const e of m.engine) ids.push(Number(e.id));
      }
    }
  }
  return ids.sort((a, b) => a - b);
}

async function legacyIds(pool, locScr, nameScr) {
  const whpramas = [];
  let whereExtra = '';
  const locationId = Number(locScr) || 0;
  let baseWhere;
  if (locationId > 0) {
    baseWhere = ` WHERE location_id = ${locationId} `;
  } else {
    baseWhere =
      " WHERE location_id IN (SELECT id FROM locations WHERE show_in_vehicle_schedule = 1 AND status = '1') ";
  }
  if (nameScr && String(nameScr).trim()) {
    whereExtra =
      ' AND (vehicles.registration LIKE ? OR mm.setting_value LIKE ? OR en.setting_value LIKE ? OR tran.setting_value LIKE ?)';
    const like = `%${String(nameScr).trim()}%`;
    whpramas.push(like, like, like, like);
  }
  const sql = `SELECT vehicles.id, vehicles.registration, vehicles.issue_color, vehicles.mot_color,
    vehicles.road_tax_color, vehicles.service_color,
    vehicles.transmission_id, vehicles.make_model_id, vehicles.engine_size_id, vehicles.location_id,
    tran.setting_value AS transmission, mm.setting_value AS make_model, (en.setting_value * 1) AS engine_size
    ${JOINS} ${baseWhere} ${whereExtra}
    ORDER BY loc.loc_abb ASC, transmission ASC, make_model ASC, engine_size ASC, vehicles.registration ASC`;
  const [rows] = await pool.query(sql, whpramas);
  return rows.filter(legacyEligible);
}

async function runCase(pool, label, query) {
  const data = await getVehicleSchedule(pool, query);
  const newIds = flattenGroups(data.groups);
  const legacyRows = await legacyIds(pool, query.loc_scr ?? 0, query.name_scr ?? '');
  const legacyIdList = legacyRows.map((r) => Number(r.id)).sort((a, b) => a - b);

  const setNew = new Set(newIds);
  const setLegacy = new Set(legacyIdList);
  const onlyNew = newIds.filter((id) => !setLegacy.has(id));
  const onlyLegacy = legacyIdList.filter((id) => !setNew.has(id));

  let colorMismatch = 0;
  const legacyById = new Map(legacyRows.map((r) => [Number(r.id), r]));
  for (const g of data.groups) {
    for (const t of g.transmission) {
      for (const m of t.make_model) {
        for (const e of m.engine) {
          const leg = legacyById.get(Number(e.id));
          if (!leg) continue;
          for (const field of ['issue_color', 'mot_color', 'road_tax_color', 'service_color']) {
            if (String(e[field] ?? '') !== String(leg[field] ?? '')) colorMismatch += 1;
          }
        }
      }
    }
  }

  console.log(`\n=== ${label} ===`);
  console.log('legacy eligible rows:', legacyIdList.length);
  console.log('new grouped vehicles:', newIds.length);
  console.log('id set match:', onlyNew.length === 0 && onlyLegacy.length === 0);
  if (onlyNew.length) console.log('only in new:', onlyNew.slice(0, 10));
  if (onlyLegacy.length) console.log('only in legacy:', onlyLegacy.slice(0, 10));
  console.log('color field mismatches (count):', colorMismatch);
  console.log('location filter options:', data.scheduleLocations.length);
}

(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await runCase(pool, 'All locations', { loc_scr: '0' });
  const [locs] = await pool.query(
    `SELECT id FROM locations WHERE show_in_vehicle_schedule = 1 AND status = 1 LIMIT 1`
  );
  if (locs[0]) {
    await runCase(pool, `Location ${locs[0].id}`, { loc_scr: String(locs[0].id) });
  }
  await runCase(pool, 'Search name_scr=EX', { loc_scr: '0', name_scr: 'EX' });
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
