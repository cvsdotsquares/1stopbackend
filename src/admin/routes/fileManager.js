const express = require('express');
const multer = require('multer');
const FileManagerController = require('../controllers/fileManagerController');
const { requireAdminSession } = require('../middleware/adminAuth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function createFileManagerRoutes() {
  const router = express.Router();
  const c = new FileManagerController();
  router.get('/', requireAdminSession, (req, res) => c.list(req, res));
  router.post('/', requireAdminSession, upload.any(), (req, res) => c.upload(req, res));
  router.post('/upload', requireAdminSession, upload.any(), (req, res) => c.upload(req, res));
  router.delete('/:filename', requireAdminSession, (req, res) => c.remove(req, res));
  router.delete('/', requireAdminSession, (req, res) => c.remove(req, res));
  return router;
}

module.exports = createFileManagerRoutes;
