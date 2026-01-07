const express = require('express');
const SearchController = require('../controllers/search');

module.exports = (pool) => {
    const router = express.Router();
    const controller = new SearchController(pool);

    router.get('/', controller.search);

    return router;
};
