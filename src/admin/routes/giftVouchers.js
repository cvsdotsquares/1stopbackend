const express = require('express');
const GiftVouchersController = require('../controllers/giftVouchersController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createGiftVouchersRoutes(pool) {
  const router = express.Router();
  const controller = new GiftVouchersController(pool);

  router.get('/', requireAdminSession, (req, res) => controller.list(req, res));
  router.get('/options', requireAdminSession, (req, res) =>
    controller.options(req, res)
  );
  router.get('/redeemed', requireAdminSession, (req, res) =>
    controller.listRedeemed(req, res)
  );
  router.get('/template', requireAdminSession, (req, res) =>
    controller.getTemplate(req, res)
  );
  router.patch('/template', requireAdminSession, (req, res) =>
    controller.updateTemplate(req, res)
  );
  router.get('/franchise/:id', requireAdminSession, (req, res) =>
    controller.getFranchise(req, res)
  );

  router.post('/', requireAdminSession, (req, res) =>
    controller.create(req, res)
  );
  router.get('/:id/print', requireAdminSession, (req, res) =>
    controller.print(req, res)
  );
  router.post('/:id/resend', requireAdminSession, (req, res) =>
    controller.resend(req, res)
  );
  router.patch('/:id/redeem', requireAdminSession, (req, res) =>
    controller.redeem(req, res)
  );
  router.get('/:id', requireAdminSession, (req, res) =>
    controller.getOne(req, res)
  );
  router.patch('/:id', requireAdminSession, (req, res) =>
    controller.update(req, res)
  );
  router.delete('/:id', requireAdminSession, (req, res) =>
    controller.remove(req, res)
  );

  return router;
}

module.exports = createGiftVouchersRoutes;
