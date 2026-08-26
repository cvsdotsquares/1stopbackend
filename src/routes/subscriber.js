const express = require('express');
const SubscriberController = require('../controllers/SubscriberController');

module.exports = (pool) => {
    const router = express.Router();
    const controller = new SubscriberController(pool);

    router.post('/subscribe', controller.subscribe);

    return router;
};
