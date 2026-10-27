const express = require('express');
const LocationCourseController = require('../controllers/locationcourse');

module.exports = (pool) => {
    const router = express.Router();
    const controller = new LocationCourseController(pool);

    router.get('/', controller.getLocationCoursePages);

    return router;
};