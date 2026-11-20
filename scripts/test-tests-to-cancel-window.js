/**
 * Smoke tests for Tests-to-cancel alert window (see product examples).
 * Run: node scripts/test-tests-to-cancel-window.js
 */
const {
  ensureEnglandBankHolidaysLoaded,
} = require('../src/utils/ukEnglandBankHolidays');
const {
  isWithinAdjustedWindow,
  countNonWorkingDaysInRange,
  testsToCancelCourseProfile,
} = require('../src/admin/services/dashboardAlertsService');

function assert(label, condition) {
  if (!condition) {
    console.error('FAIL:', label);
    process.exitCode = 1;
    return;
  }
  console.log('OK:', label);
}

async function main() {
  await ensureEnglandBankHolidaysLoaded();

  assert('Module base window is 4 days', testsToCancelCourseProfile('Mod 1', 'Module 1 Test Day') === 4);
  assert('Motorcycle base window is 3 days', testsToCancelCourseProfile('3 Day A1', 'A1 Motorcycle Licence - 11kw/14.6bhp (Cat A1 - 3 Days)') === 3);

  const MODULE = 4;
  const MOTOR = 3;

  // Module 1 on Friday → alert from Monday (4 calendar days)
  const fri = '2026-11-27';
  const mon = '2026-11-23';
  assert(
    'Module: Friday start, alert Monday (4 days)',
    isWithinAdjustedWindow(mon, fri, MODULE)
  );
  assert(
    'Module: Friday start, not alert prior Sunday (5 days)',
    !isWithinAdjustedWindow('2026-11-22', fri, MODULE)
  );

  // Module on Monday → earliest alert Wednesday (5 days, Sunday in range)
  const modStartMon = '2026-11-24';
  assert(
    'Module: Monday start, alert Wednesday (5 days, +1 Sunday)',
    isWithinAdjustedWindow('2026-11-19', modStartMon, MODULE)
  );
  assert(
    'Module: Monday start, not alert Tuesday (6 days)',
    !isWithinAdjustedWindow('2026-11-18', modStartMon, MODULE)
  );

  // Motorcycle Friday → alert from Tuesday (3 days)
  assert(
    'Motorcycle: Friday start, alert Tuesday (3 days)',
    isWithinAdjustedWindow('2026-11-24', fri, MOTOR)
  );
  assert(
    'Motorcycle: Friday start, not alert Monday (4 days)',
    !isWithinAdjustedWindow('2026-11-23', fri, MOTOR)
  );

  // Motorcycle Monday → alert from Thursday (4 days, Sunday in range)
  const mcStartMon = '2026-11-24';
  assert(
    'Motorcycle: Monday start, alert Thursday (4 days, +1 Sunday)',
    isWithinAdjustedWindow('2026-11-20', mcStartMon, MOTOR)
  );
  assert(
    'Motorcycle: Monday start, not alert Wednesday (5 days)',
    !isWithinAdjustedWindow('2026-11-19', mcStartMon, MOTOR)
  );

  // Module Monday start with Sunday + bank holiday in range (Easter 2026) → 6 days before
  const easterMondayStart = '2026-04-06';
  const alertSixDays = '2026-03-31';
  const extra = countNonWorkingDaysInRange(alertSixDays, easterMondayStart);
  assert(
    `Module: Sun+bank holiday adds 2 extras (got ${extra})`,
    extra === 2
  );
  assert(
    'Module: Monday start, alert 6 days out with Sun+BH',
    isWithinAdjustedWindow(alertSixDays, easterMondayStart, MODULE)
  );
  assert(
    'Module: Monday start, not alert 7 days out with Sun+BH',
    !isWithinAdjustedWindow('2026-03-30', easterMondayStart, MODULE)
  );

  // Motorcycle: same Sun+BH window → 5 days before (base 3 + 2)
  assert(
    'Motorcycle: Monday Easter start, alert 5 days out',
    isWithinAdjustedWindow('2026-04-01', easterMondayStart, MOTOR)
  );
  assert(
    'Motorcycle: Monday Easter start, not alert 6 days out',
    !isWithinAdjustedWindow('2026-03-31', easterMondayStart, MOTOR)
  );

  console.log(process.exitCode ? '\nSome checks failed.' : '\nAll window checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});