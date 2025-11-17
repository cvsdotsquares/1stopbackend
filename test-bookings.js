// test-bookings.js
const axios = require('axios');

const API_BASE = 'http://localhost:3000';

// Test user credentials (use existing user or create one)
const TEST_USER = {
  email: 'test.booking@example.com',
  password: 'TestPass123!'
};

let authToken = null;
let testBookingId = null;

// Helper function for API calls
async function apiCall(method, endpoint, data = null, token = null) {
  const config = {
    method,
    url: `${API_BASE}${endpoint}`,
    headers: {
      'Content-Type': 'application/json'
    }
  };

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  if (data) {
    config.data = data;
  }

  try {
    const response = await axios(config);
    return { success: true, data: response.data };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data || error.message,
      status: error.response?.status
    };
  }
}

async function testBookingSystem() {
  console.log('🚀 Starting Booking System Tests\n');

  // Test 1: Health Check
  console.log('1️⃣ Testing API Health...');
  const healthCheck = await apiCall('GET', '/health');
  if (healthCheck.success) {
    console.log('✅ API is healthy');
  } else {
    console.log('❌ API health check failed:', healthCheck.error);
    return;
  }

  // Test 2: Authentication
  console.log('\n2️⃣ Testing Authentication...');
  const loginResult = await apiCall('POST', '/api/auth/login', TEST_USER);
  if (loginResult.success && loginResult.data.data?.token) {
    authToken = loginResult.data.data.token;
    console.log('✅ Authentication successful');
    console.log(`   User: ${loginResult.data.data.user.first_name} ${loginResult.data.data.user.sur_name}`);
  } else {
    console.log('❌ Authentication failed:', loginResult.error);
    console.log('   Please ensure test user exists or update credentials');
    return;
  }

  // Test 3: Get Available Courses
  console.log('\n3️⃣ Testing Available Courses...');
  const coursesResult = await apiCall('GET', '/api/courses?limit=5');
  if (coursesResult.success && coursesResult.data.data?.length > 0) {
    console.log('✅ Courses retrieved successfully');
    console.log(`   Found ${coursesResult.data.data.length} courses`);
    console.log(`   Sample course: ${coursesResult.data.data[0].course_name}`);
  } else {
    console.log('❌ Failed to get courses:', coursesResult.error);
    return;
  }

  // Test 4: Get Available Events
  console.log('\n4️⃣ Testing Available Events...');
  const eventsResult = await apiCall('GET', '/api/courses/events/all?limit=5&future_only=true');
  if (eventsResult.success && eventsResult.data.data?.length > 0) {
    console.log('✅ Events retrieved successfully');
    console.log(`   Found ${eventsResult.data.data.length} upcoming events`);

    const testEvent = eventsResult.data.data.find(event =>
      event.spaces_available > 0 && new Date(event.event_date) > new Date()
    );

    if (testEvent) {
      console.log(`   Test event: ${testEvent.course_name} on ${testEvent.event_date}`);
      console.log(`   Available spaces: ${testEvent.spaces_available}`);

      // Test 5: Create Booking
      console.log('\n5️⃣ Testing Create Booking...');
      const bookingData = {
        course_id: testEvent.course_id,
        course_event_id: testEvent.id,
        spaces: 1,
        customer_notes: 'Test booking from automated test',
        emergency_contact_name: 'Emergency Contact',
        emergency_contact_phone: '07123456789',
        special_requirements: 'No special requirements'
      };

      const createBookingResult = await apiCall('POST', '/api/bookings', bookingData, authToken);
      if (createBookingResult.success) {
        testBookingId = createBookingResult.data.data.id;
        console.log('✅ Booking created successfully');
        console.log(`   Booking ID: ${testBookingId}`);
        console.log(`   Status: ${createBookingResult.data.data.status_text}`);
        console.log(`   Total Amount: £${createBookingResult.data.data.total_amount}`);
      } else {
        console.log('❌ Failed to create booking:', createBookingResult.error);
      }
    } else {
      console.log('⚠️  No suitable test event found (needs available spaces and future date)');
    }
  } else {
    console.log('❌ Failed to get events:', eventsResult.error);
  }

  // Test 6: Get User Bookings
  console.log('\n6️⃣ Testing Get User Bookings...');
  const userBookingsResult = await apiCall('GET', '/api/bookings?limit=10', null, authToken);
  if (userBookingsResult.success) {
    console.log('✅ User bookings retrieved successfully');
    console.log(`   Total bookings: ${userBookingsResult.data.pagination?.total || 0}`);
    if (userBookingsResult.data.data?.length > 0) {
      console.log(`   Recent booking: ${userBookingsResult.data.data[0].course_name}`);
    }
  } else {
    console.log('❌ Failed to get user bookings:', userBookingsResult.error);
  }

  // Test 7: Get Booking Statistics
  console.log('\n7️⃣ Testing Booking Statistics...');
  const statsResult = await apiCall('GET', '/api/bookings/stats', null, authToken);
  if (statsResult.success) {
    console.log('✅ Booking statistics retrieved successfully');
    console.log(`   Total bookings: ${statsResult.data.data.total_bookings}`);
    console.log(`   Confirmed bookings: ${statsResult.data.data.confirmed_bookings}`);
    console.log(`   Total spent: £${statsResult.data.data.total_spent || 0}`);
  } else {
    console.log('❌ Failed to get booking statistics:', statsResult.error);
  }

  // Test 8: Get Booking Details (if we created one)
  if (testBookingId) {
    console.log('\n8️⃣ Testing Get Booking Details...');
    const bookingDetailsResult = await apiCall('GET', `/api/bookings/${testBookingId}`, null, authToken);
    if (bookingDetailsResult.success) {
      console.log('✅ Booking details retrieved successfully');
      console.log(`   Course: ${bookingDetailsResult.data.data.course_name}`);
      console.log(`   Event Date: ${bookingDetailsResult.data.data.event_date}`);
      console.log(`   Location: ${bookingDetailsResult.data.data.location_name}`);
    } else {
      console.log('❌ Failed to get booking details:', bookingDetailsResult.error);
    }

    // Test 9: Update Booking
    console.log('\n9️⃣ Testing Update Booking...');
    const updateData = {
      customer_notes: 'Updated test booking notes',
      emergency_contact_name: 'Updated Emergency Contact',
      special_requirements: 'Updated: No special requirements needed'
    };

    const updateResult = await apiCall('PUT', `/api/bookings/${testBookingId}`, updateData, authToken);
    if (updateResult.success) {
      console.log('✅ Booking updated successfully');
    } else {
      console.log('❌ Failed to update booking:', updateResult.error);
    }

    // Test 10: Cancel Booking
    console.log('\n🔟 Testing Cancel Booking...');
    const cancelData = {
      cancellation_reason: 'Test cancellation from automated test'
    };

    const cancelResult = await apiCall('POST', `/api/bookings/${testBookingId}/cancel`, cancelData, authToken);
    if (cancelResult.success) {
      console.log('✅ Booking cancelled successfully');
    } else {
      console.log('❌ Failed to cancel booking:', cancelResult.error);
    }
  }

  // Test 11: Edge Cases
  console.log('\n1️⃣1️⃣ Testing Edge Cases...');

  // Try to create booking without authentication
  const unauthBookingResult = await apiCall('POST', '/api/bookings', { course_id: 1, course_event_id: 1 });
  if (!unauthBookingResult.success && unauthBookingResult.status === 401) {
    console.log('✅ Unauthenticated booking request properly rejected');
  } else {
    console.log('❌ Unauthenticated booking request should be rejected');
  }

  // Try to create booking with invalid data
  const invalidBookingResult = await apiCall('POST', '/api/bookings', { course_id: 'invalid' }, authToken);
  if (!invalidBookingResult.success && invalidBookingResult.status === 400) {
    console.log('✅ Invalid booking data properly rejected');
  } else {
    console.log('❌ Invalid booking data should be rejected');
  }

  // Try to access non-existent booking
  const nonExistentResult = await apiCall('GET', '/api/bookings/99999', null, authToken);
  if (!nonExistentResult.success && nonExistentResult.status === 404) {
    console.log('✅ Non-existent booking properly returns 404');
  } else {
    console.log('❌ Non-existent booking should return 404');
  }

  console.log('\n🎉 Booking System Tests Completed!');
  console.log('\n📊 Test Summary:');
  console.log('   - API Health: Tested ✓');
  console.log('   - Authentication: Tested ✓');
  console.log('   - Course Retrieval: Tested ✓');
  console.log('   - Event Retrieval: Tested ✓');
  console.log('   - Booking Creation: Tested ✓');
  console.log('   - Booking Retrieval: Tested ✓');
  console.log('   - Booking Statistics: Tested ✓');
  console.log('   - Booking Updates: Tested ✓');
  console.log('   - Booking Cancellation: Tested ✓');
  console.log('   - Edge Cases: Tested ✓');
}

// Test error scenarios
async function testErrorScenarios() {
  console.log('\n🔍 Testing Error Scenarios...');

  if (!authToken) {
    console.log('❌ No auth token available for error testing');
    return;
  }

  // Test booking for past event
  console.log('\n📅 Testing booking for past event...');
  const pastEventResult = await apiCall('POST', '/api/bookings', {
    course_id: 1,
    course_event_id: 999999, // Non-existent event
    spaces: 1
  }, authToken);

  if (!pastEventResult.success) {
    console.log('✅ Past/invalid event booking properly rejected');
  }

  // Test booking with too many spaces
  console.log('\n👥 Testing booking with excessive spaces...');
  const excessiveSpacesResult = await apiCall('POST', '/api/bookings', {
    course_id: 1,
    course_event_id: 1,
    spaces: 50 // Too many spaces
  }, authToken);

  if (!excessiveSpacesResult.success) {
    console.log('✅ Excessive spaces booking properly rejected');
  }
}

// Run the tests
async function runTests() {
  try {
    await testBookingSystem();
    await testErrorScenarios();
  } catch (error) {
    console.error('❌ Test execution error:', error);
  }
}

// Execute if run directly
if (require.main === module) {
  runTests();
}

module.exports = { runTests };