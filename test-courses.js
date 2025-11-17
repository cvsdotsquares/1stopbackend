// test-courses.js - Course Management System test script
const axios = require('axios');

const BASE_URL = 'http://localhost:3000/api';

async function testCourseManagement() {
  console.log('🧪 Testing 1Stop Instruction Course Management System\n');

  try {
    // ===== COURSE TESTS =====
    console.log('📚 TESTING COURSE ENDPOINTS');
    console.log('=' .repeat(50));

    // Test 1: Get all courses
    console.log('1️⃣  Testing Get All Courses...');
    const coursesResponse = await axios.get(`${BASE_URL}/courses?limit=5`);
    console.log(`✅ Found ${coursesResponse.data.data.courses.length} courses`);
    console.log(`   Total courses: ${coursesResponse.data.data.pagination.total}`);
    
    const firstCourse = coursesResponse.data.data.courses[0];
    if (firstCourse) {
      console.log(`   First course: ${firstCourse.course_name} (ID: ${firstCourse.id})`);
    }
    console.log();

    // Test 2: Get featured courses
    console.log('2️⃣  Testing Featured Courses...');
    const featuredResponse = await axios.get(`${BASE_URL}/courses/featured`);
    console.log(`✅ Found ${featuredResponse.data.data.length} featured courses`);
    featuredResponse.data.data.forEach((course, index) => {
      console.log(`   ${index + 1}. ${course.course_name} - £${course.dsa_fees} (${course.booking_count} recent bookings)`);
    });
    console.log();

    // Test 3: Get course by ID
    if (firstCourse) {
      console.log('3️⃣  Testing Get Course by ID...');
      const courseDetailResponse = await axios.get(`${BASE_URL}/courses/${firstCourse.id}`);
      const courseDetail = courseDetailResponse.data.data.course;
      console.log(`✅ Course Details: ${courseDetail.course_name}`);
      console.log(`   Description length: ${courseDetail.description?.length || 0} chars`);
      console.log(`   Default booking limit: ${courseDetail.default_booking_limit}`);
      console.log(`   Is CBT: ${courseDetail.is_cbt ? 'Yes' : 'No'}`);
      console.log(`   Upcoming events: ${courseDetailResponse.data.data.upcoming_events?.length || 0}`);
      console.log();
    }

    // Test 4: Search courses
    console.log('4️⃣  Testing Course Search...');
    const searchResponse = await axios.get(`${BASE_URL}/courses/search?q=CBT&limit=3`);
    console.log(`✅ Search results for "CBT": ${searchResponse.data.data.courses.length} courses`);
    searchResponse.data.data.courses.forEach(course => {
      console.log(`   - ${course.course_name} (${course.available_events} events)`);
    });
    console.log();

    // ===== LOCATION TESTS =====
    console.log('🏢 TESTING LOCATION ENDPOINTS');
    console.log('=' .repeat(50));

    // Test 5: Get all locations
    console.log('5️⃣  Testing Get All Locations...');
    const locationsResponse = await axios.get(`${BASE_URL}/courses/locations/all?limit=5`);
    console.log(`✅ Found ${locationsResponse.data.data.locations.length} locations`);
    console.log(`   Total locations: ${locationsResponse.data.data.pagination.total}`);
    
    const firstLocation = locationsResponse.data.data.locations[0];
    if (firstLocation) {
      console.log(`   First location: ${firstLocation.location_name} (${firstLocation.postcode})`);
    }
    console.log();

    // Test 6: Get locations with courses
    console.log('6️⃣  Testing Locations with Courses...');
    const locationsWithCoursesResponse = await axios.get(`${BASE_URL}/courses/locations/with-courses`);
    console.log(`✅ Found ${locationsWithCoursesResponse.data.data.length} locations with available courses`);
    locationsWithCoursesResponse.data.data.slice(0, 3).forEach(location => {
      console.log(`   - ${location.location_name}: ${location.available_events} events, ${location.available_courses} courses`);
    });
    console.log();

    // Test 7: Find nearest locations (London coordinates)
    console.log('7️⃣  Testing Find Nearest Locations...');
    const nearestResponse = await axios.get(`${BASE_URL}/courses/locations/nearest?latitude=51.5074&longitude=-0.1278&radius=30&limit=3`);
    console.log(`✅ Found ${nearestResponse.data.data.length} locations within 30 miles of London`);
    nearestResponse.data.data.forEach(location => {
      console.log(`   - ${location.location_name}: ${location.distance_miles} miles away`);
    });
    console.log();

    // Test 8: Get location by ID
    if (firstLocation) {
      console.log('8️⃣  Testing Get Location by ID...');
      const locationDetailResponse = await axios.get(`${BASE_URL}/courses/locations/${firstLocation.id}`);
      const locationDetail = locationDetailResponse.data.data.location;
      console.log(`✅ Location Details: ${locationDetail.location_name}`);
      console.log(`   Address: ${locationDetail.address1}, ${locationDetail.postcode}`);
      console.log(`   Coordinates: ${locationDetail.latitude}, ${locationDetail.longitude}`);
      console.log(`   Upcoming events: ${locationDetailResponse.data.data.upcoming_events?.length || 0}`);
      console.log();
    }

    // ===== EVENT TESTS =====
    console.log('📅 TESTING EVENT ENDPOINTS');
    console.log('=' .repeat(50));

    // Test 9: Get course events
    console.log('9️⃣  Testing Get Course Events...');
    const eventsResponse = await axios.get(`${BASE_URL}/courses/events/all?limit=3`);
    console.log(`✅ Found ${eventsResponse.data.data.events.length} course events`);
    const firstEvent = eventsResponse.data.data.events[0];
    if (firstEvent) {
      console.log(`   First event: ${firstEvent.course_name} at ${firstEvent.location_name}`);
      console.log(`   Dates available: ${firstEvent.dates?.length || 0}`);
      console.log(`   Spaces available: ${firstEvent.spaces_available}`);
    }
    console.log();

    // Test 10: Get available dates for a course
    if (firstCourse) {
      console.log('🔟 Testing Get Available Dates...');
      const availableDatesResponse = await axios.get(`${BASE_URL}/courses/events/available-dates?course_id=${firstCourse.id}&spaces_required=1`);
      console.log(`✅ Found ${availableDatesResponse.data.data.available_dates.length} available dates for ${firstCourse.course_name}`);
      availableDatesResponse.data.data.available_dates.slice(0, 3).forEach(date => {
        console.log(`   - ${date.event_date} ${date.event_start_time}-${date.event_end_time} at ${date.location_name} (${date.spaces_available} spaces)`);
      });
      console.log();
    }

    // Test 11: Get event calendar
    console.log('1️⃣1️⃣ Testing Event Calendar...');
    const currentDate = new Date();
    const calendarResponse = await axios.get(`${BASE_URL}/courses/events/calendar?year=${currentDate.getFullYear()}&month=${currentDate.getMonth() + 1}`);
    console.log(`✅ Calendar for ${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}: ${calendarResponse.data.data.calendar_days.length} days with events`);
    calendarResponse.data.data.calendar_days.slice(0, 3).forEach(day => {
      console.log(`   - ${day.event_date}: ${day.events_count} events, ${day.total_spaces_available} spaces available`);
    });
    console.log();

    // Test 12: Check availability
    if (firstEvent && firstEvent.dates && firstEvent.dates[0]) {
      console.log('1️⃣2️⃣ Testing Check Availability...');
      const availabilityResponse = await axios.get(`${BASE_URL}/courses/events/check-availability?event_id=${firstEvent.event_id}&date_id=${firstEvent.dates[0].date_id}&spaces_required=1`);
      const availability = availabilityResponse.data.data;
      console.log(`✅ Availability Check: ${availability.availability_status}`);
      console.log(`   Event: ${availability.course_name} at ${availability.location_name}`);
      console.log(`   Date: ${availability.event_date} ${availability.event_start_time}-${availability.event_end_time}`);
      console.log(`   Available: ${availability.is_available ? 'Yes' : 'No'} (${availability.spaces_available} spaces)`);
      console.log();
    }

    // ===== INTEGRATION TESTS =====
    console.log('🔄 TESTING INTEGRATION SCENARIOS');
    console.log('=' .repeat(50));

    // Test 13: Search for CBT courses with events in London area
    console.log('1️⃣3️⃣ Testing CBT Course Search with Location Filter...');
    const cbtSearchResponse = await axios.get(`${BASE_URL}/courses/search?q=CBT&has_events=true&limit=5`);
    console.log(`✅ CBT courses with events: ${cbtSearchResponse.data.data.courses.length}`);
    
    if (cbtSearchResponse.data.data.courses.length > 0) {
      const cbtCourse = cbtSearchResponse.data.data.courses[0];
      console.log(`   Selected: ${cbtCourse.course_name}`);
      
      // Get available dates for this CBT course
      const cbtDatesResponse = await axios.get(`${BASE_URL}/courses/events/available-dates?course_id=${cbtCourse.id}&spaces_required=1`);
      console.log(`   Available dates: ${cbtDatesResponse.data.data.available_dates.length}`);
      
      if (cbtDatesResponse.data.data.available_dates.length > 0) {
        const nearbyLocations = cbtDatesResponse.data.data.available_dates
          .reduce((acc, date) => {
            if (!acc.find(loc => loc.location_name === date.location_name)) {
              acc.push({
                location_name: date.location_name,
                postcode: date.postcode,
                dates_available: cbtDatesResponse.data.data.available_dates
                  .filter(d => d.location_name === date.location_name).length
              });
            }
            return acc;
          }, []);
          
        console.log(`   Available locations:`);
        nearbyLocations.slice(0, 3).forEach(loc => {
          console.log(`     - ${loc.location_name} (${loc.postcode}): ${loc.dates_available} dates`);
        });
      }
    }
    console.log();

    console.log('🎉 All Course Management System tests completed successfully!');
    console.log('\n📋 Course Management API Summary:');
    console.log('   ✅ Course listing and details');
    console.log('   ✅ Location management');
    console.log('   ✅ Event scheduling and availability');
    console.log('   ✅ Search and filtering');
    console.log('   ✅ Calendar integration');
    console.log('   ✅ Real-time availability checking');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    if (error.response?.status) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   URL: ${error.config?.url}`);
    }
  }
}

// Run if called directly
if (require.main === module) {
  testCourseManagement();
}

module.exports = testCourseManagement;