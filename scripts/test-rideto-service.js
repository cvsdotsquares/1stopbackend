const assert = require('assert');
const {
  RIDETO_LOCATIONS,
  RIDETO_LOCATION_IDS,
  getRideToConfig,
  isRideToEligible,
  createRideToCourse,
} = require('../src/admin/services/rideToApiService');

async function runTests() {
  console.log('Testing RideTo Service...');

  // 1. Eligibility test
  assert.strictEqual(isRideToEligible(1, 1), true, 'CBT at Ilford (1) should be eligible');
  assert.strictEqual(isRideToEligible(1, 4), true, 'CBT at Tottenham (4) should be eligible');
  assert.strictEqual(isRideToEligible(1, 15), true, 'CBT at Beckton (15) should be eligible');
  assert.strictEqual(isRideToEligible(1, 18), true, 'CBT at Barnet (18) should be eligible');
  assert.strictEqual(isRideToEligible('1', '15'), true, 'String numbers should be parsed');
  assert.strictEqual(isRideToEligible(2, 1), false, 'Non-CBT course (2) should not be eligible');
  assert.strictEqual(isRideToEligible(1, 99), false, 'Unknown location (99) should not be eligible');

  // 2. Config test
  const config = getRideToConfig();
  assert(config.apiUrl.length > 0, 'apiUrl should be non-empty');
  assert(config.authKey.length > 0, 'authKey should be non-empty');

  // 3. Location Slugs
  assert.strictEqual(RIDETO_LOCATIONS[1], '1-stop-instruction-ilford');
  assert.strictEqual(RIDETO_LOCATIONS[4], '1-stop-instruction-tottenham');
  assert.strictEqual(RIDETO_LOCATIONS[15], '1-stop-instruction-beckton');
  assert.strictEqual(RIDETO_LOCATIONS[18], '1-stop-instruction-barnet');

  // 4. Test when RideTo setting is disabled
  const mockDbDisabled = {
    async query(sql) {
      if (sql.includes('is_r2api_setting')) {
        return [[{ is_r2api_setting: 0 }]];
      }
      return [[]];
    },
  };
  const resDisabled = await createRideToCourse(123, null, mockDbDisabled);
  assert.strictEqual(resDisabled.skipped, true);
  assert.strictEqual(resDisabled.reason, 'RideTo API is disabled in settings');

  // 5. Test createRideToCourse with mock DB and simulated RideTo response
  let updatedEventId = null;
  let updatedRidetoCourseId = null;
  const mockDbEnabled = {
    async query(sql, params) {
      if (sql.includes('is_r2api_setting')) {
        return [[{ is_r2api_setting: 1 }]];
      }
      if (sql.includes('UPDATE course_events SET rideto_course_id')) {
        assert(sql.includes("rideto_api_status = 'on'"), 'SQL must update rideto_api_status to on');
        updatedRidetoCourseId = params[0];
        updatedEventId = params[1];
        return [{ affectedRows: 1 }];
      }
      return [[]];
    },
  };

  // Mock global fetch
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    assert(url.includes('create-course'), 'Must call create-course');
    assert.strictEqual(options.method, 'POST');
    const body = JSON.parse(options.body);
    assert.strictEqual(body.course_type, 'LICENCE_CBT');
    assert.strictEqual(body.location, '1-stop-instruction-ilford');
    assert.strictEqual(body.spaces, 4);
    assert.strictEqual(body.date, '2026-11-01');
    assert.strictEqual(body.start_time, '08:30:00');
    assert.strictEqual(body.finish_time, '16:30:00');

    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          rideto_course_id: 98765,
          message: 'Success',
        });
      },
    };
  };

  try {
    const result = await createRideToCourse(
      555,
      {
        courseId: 1,
        locationId: 1,
        spaces: 4,
        date: '2026-11-01',
        startTime: '08:30',
        endTime: '16:30',
      },
      mockDbEnabled
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.rideto_course_id, 98765);
    assert.strictEqual(updatedEventId, 555);
    assert.strictEqual(updatedRidetoCourseId, 98765);
    console.log('✓ All RideTo Service tests passed successfully!');
  } finally {
    global.fetch = originalFetch;
  }
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
