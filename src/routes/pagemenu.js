const express = require('express');
const PageMenuController = require('../controllers/pagemenu');

module.exports = (pool) => {
    const router = express.Router();
    const controller = new PageMenuController(pool);

    router.get('/', controller.getPageMenus);

    return router;
};
