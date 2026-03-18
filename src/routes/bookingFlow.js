// src/routes/bookingFlow.js
const express = require('express');
const BookingFlowController = require('../controllers/bookingFlow');
const BookingController = require('../controllers/bookings');

const router = express.Router();

module.exports = (pool) => {
  const bookingFlowController = new BookingFlowController(pool);
  const bookingController = new BookingController(pool);

  /**
   * @route GET /api/booking/courses
   * @desc Get courses for booking
   * @access Public
   */
  router.get('/courses', bookingFlowController.getCourses.bind(bookingFlowController));

  /**
   * @route GET /api/booking/locations/:course_id
   * @desc Get locations for specific course
   * @access Public
   */
  router.get('/locations/:course_id', bookingFlowController.getLocationsByCourse.bind(bookingFlowController));

  /**
   * @route GET /api/booking/course-availability
   * @desc Get course availability for specific course and location
   * @access Public
   */
  router.get('/course-availability', bookingFlowController.getCourseAvailability.bind(bookingFlowController));

  /**
   * @route GET /api/booking/next-availability-cbt
   * @desc Get next available date for CBT course (ID=1) with location details
   * @access Public
   */
  router.get('/next-availability-cbt', bookingFlowController.getNextAvailabilityForCBT.bind(bookingFlowController));

  /**
   * @route POST /api/booking/lock
   * @desc Create booking lock
   * @access Public
   */
  router.post('/lock', bookingController.createBookingLock.bind(bookingController));

  /**
   * @route GET /api/booking/settings
   * @desc Get system settings
   * @access Public
   */
  router.get('/settings', bookingFlowController.getSettings.bind(bookingFlowController));

  /**
   * @route GET /api/booking/vehicle-types/:courseId/:locationId
   * @desc Get available vehicle types for course and location
   * @access Public
   */
  router.get('/vehicle-types/:courseId/:locationId/:courseEventId', bookingFlowController.getVehicleTypesByCourseLocation.bind(bookingFlowController));

  /**
   * @route GET /api/booking/license-types
   * @desc Get all license types
   * @access Public
   */
  router.get('/license-types', bookingFlowController.getLicenseTypes.bind(bookingFlowController));

  /**
   * @route POST /api/booking/attendee
   * @desc Process attendee data with validation
   * @access Public
   */
  router.post('/attendee', bookingFlowController.processAttendee.bind(bookingFlowController));

  /**
   * @route POST /api/booking/promo-codes/validate
   * @desc Validate promo code
   * @access Public
   */
  router.post('/promo-codes/validate', bookingFlowController.validatePromoCode.bind(bookingFlowController));

  /**
   * @route POST /api/booking/create-with-attendees
   * @desc Create booking with attendees
   * @access Public
   */
  router.post('/create-with-attendees', bookingFlowController.createBookingWithAttendees.bind(bookingFlowController));

  /**
   * @route POST /api/booking-flow/create-booking-with-attendees
   * @desc Create booking with attendees (alternative path)
   * @access Public
   */
  router.post('/create-booking-with-attendees', bookingFlowController.createBookingWithAttendees.bind(bookingFlowController));

  return router;
};