// src/routes/courses.js
const express = require('express');
const { query } = require('express-validator');
const CourseController = require('../controllers/courses');
const LocationController = require('../controllers/locations');
const CourseEventsController = require('../controllers/courseEvents');
const { authenticateToken } = require('../middleware/auth');

function createCourseRoutes(pool) {
  const router = express.Router();
  const courseController = new CourseController(pool);
  const locationController = new LocationController(pool);
  const courseEventsController = new CourseEventsController(pool);

  // Validation middleware
  const paginationValidation = [
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
    query('offset')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Offset must be 0 or greater')
  ];

  const dateValidation = [
    query('date_from')
      .optional()
      .isISO8601()
      .withMessage('Date from must be in YYYY-MM-DD format'),
    query('date_to')
      .optional()
      .isISO8601()
      .withMessage('Date to must be in YYYY-MM-DD format')
  ];

  const coordinatesValidation = [
    query('latitude')
      .optional()
      .isFloat({ min: -90, max: 90 })
      .withMessage('Latitude must be between -90 and 90'),
    query('longitude')
      .optional()
      .isFloat({ min: -180, max: 180 })
      .withMessage('Longitude must be between -180 and 180')
  ];

  // ===== COURSE ROUTES =====
  
  // Get all courses
  router.get('/', paginationValidation, courseController.getCourses.bind(courseController));
  
  // Get featured/popular courses
  router.get('/featured', courseController.getFeaturedCourses.bind(courseController));
  
  // Search courses with filters
  router.get('/search', [
    ...paginationValidation,
    ...dateValidation,
    query('q').optional().trim().isLength({ max: 255 }).withMessage('Search query too long'),
    query('location_id').optional().isInt({ min: 1 }).withMessage('Location ID must be a positive integer'),
    query('price_min').optional().isFloat({ min: 0 }).withMessage('Minimum price must be 0 or greater'),
    query('price_max').optional().isFloat({ min: 0 }).withMessage('Maximum price must be 0 or greater'),
    query('is_cbt').optional().isBoolean().withMessage('is_cbt must be true or false'),
    query('has_events').optional().isBoolean().withMessage('has_events must be true or false')
  ], courseController.searchCourses.bind(courseController));
  
  // Get course by ID
  router.get('/:id', [
    query('id').isInt({ min: 1 }).withMessage('Course ID must be a positive integer')
  ], courseController.getCourseById.bind(courseController));
  
  // Get course statistics (protected route)
  router.get('/:id/stats', [
    authenticateToken,
    query('id').isInt({ min: 1 }).withMessage('Course ID must be a positive integer')
  ], courseController.getCourseStats.bind(courseController));

  // ===== LOCATION ROUTES =====
  
  // Get all locations
  router.get('/locations/all', paginationValidation, locationController.getLocations.bind(locationController));
  
  // Get locations with available courses
  router.get('/locations/with-courses', [
    ...dateValidation,
    query('course_id').optional().isInt({ min: 1 }).withMessage('Course ID must be a positive integer')
  ], locationController.getLocationsWithCourses.bind(locationController));
  
  // Find nearest locations
  router.get('/locations/nearest', [
    ...coordinatesValidation,
    query('postcode').optional().trim().matches(/^[A-Z]{1,2}[0-9RCHNQ][0-9A-Z]?\s?[0-9][ABD-HJLNP-UW-Z]{2}$/i)
      .withMessage('Invalid UK postcode format'),
    query('radius').optional().isFloat({ min: 1, max: 200 }).withMessage('Radius must be between 1 and 200 miles'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50')
  ], locationController.findNearestLocations.bind(locationController));
  
  // Get location statistics (protected route)
  router.get('/locations/stats', authenticateToken, locationController.getLocationStats.bind(locationController));
  
  // Get location by ID
  router.get('/locations/:id', [
    query('id').isInt({ min: 1 }).withMessage('Location ID must be a positive integer')
  ], locationController.getLocationById.bind(locationController));

  // ===== COURSE EVENTS ROUTES =====
  
  // Get course events (schedules)
  router.get('/events/all', [
    ...paginationValidation,
    ...dateValidation,
    query('course_id').optional().isInt({ min: 1 }).withMessage('Course ID must be a positive integer'),
    query('location_id').optional().isInt({ min: 1 }).withMessage('Location ID must be a positive integer'),
    query('status').optional().isIn(['0', '1']).withMessage('Status must be 0 or 1')
  ], courseEventsController.getCourseEvents.bind(courseEventsController));
  
  // Get available dates for booking
  router.get('/events/available-dates', [
    query('course_id').isInt({ min: 1 }).withMessage('Course ID is required and must be a positive integer'),
    query('location_id').optional().isInt({ min: 1 }).withMessage('Location ID must be a positive integer'),
    ...dateValidation,
    query('spaces_required').optional().isInt({ min: 1, max: 10 }).withMessage('Spaces required must be between 1 and 10')
  ], courseEventsController.getAvailableDates.bind(courseEventsController));
  
  // Get event calendar
  router.get('/events/calendar', [
    query('course_id').optional().isInt({ min: 1 }).withMessage('Course ID must be a positive integer'),
    query('location_id').optional().isInt({ min: 1 }).withMessage('Location ID must be a positive integer'),
    query('year').optional().isInt({ min: 2020, max: 2030 }).withMessage('Year must be between 2020 and 2030'),
    query('month').optional().isInt({ min: 1, max: 12 }).withMessage('Month must be between 1 and 12')
  ], courseEventsController.getEventCalendar.bind(courseEventsController));
  
  // Check availability for specific event and date
  router.get('/events/check-availability', [
    query('event_id').isInt({ min: 1 }).withMessage('Event ID is required and must be a positive integer'),
    query('date_id').isInt({ min: 1 }).withMessage('Date ID is required and must be a positive integer'),
    query('spaces_required').optional().isInt({ min: 1, max: 10 }).withMessage('Spaces required must be between 1 and 10')
  ], courseEventsController.checkAvailability.bind(courseEventsController));
  
  // Get course event by ID
  router.get('/events/:id', [
    query('id').isInt({ min: 1 }).withMessage('Event ID must be a positive integer')
  ], courseEventsController.getCourseEventById.bind(courseEventsController));

  // ===== COMBINED/UTILITY ROUTES =====
  
  // Get course with locations and events (comprehensive endpoint)
  router.get('/:course_id/details', [
    query('course_id').isInt({ min: 1 }).withMessage('Course ID must be a positive integer'),
    ...dateValidation
  ], async (req, res) => {
    try {
      const { course_id } = req.params;
      const { date_from, date_to } = req.query;
      
      // Get course details
      const courseReq = { params: { id: course_id } };
      const courseRes = {
        json: (data) => ({ courseData: data }),
        status: (code) => ({ json: (data) => ({ error: data, statusCode: code }) })
      };
      
      // This is a simplified approach - in production you'd want better composition
      res.json({
        success: true,
        message: 'Use individual endpoints for now: /api/courses/:id, /api/courses/events/available-dates?course_id=X',
        endpoints: {
          course_details: `/api/courses/${course_id}`,
          available_dates: `/api/courses/events/available-dates?course_id=${course_id}`,
          locations_with_course: `/api/courses/locations/with-courses?course_id=${course_id}`
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch comprehensive course details',
        error: error.message
      });
    }
  });

  return router;
}

module.exports = createCourseRoutes;