const { listFiles, uploadFile, deleteFile } = require('../services/fileManagerService');

function mapFiles(req) {
  return (req.files || []).map((f) => ({
    fieldname: f.fieldname,
    buffer: f.buffer,
    originalname: f.originalname,
  }));
}

class FileManagerController {
  async list(req, res) {
    try {
      const data = listFiles({ name_scr: req.query.name_scr ?? req.query.search });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][FILES][LIST]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to list files' });
    }
  }

  async upload(req, res) {
    try {
      const files = mapFiles(req);
      if (!files.length) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
      }
      const uploaded = [];
      const errors = [];
      for (const file of files) {
        const result = uploadFile(file);
        if (!result.ok) {
          errors.push(result.message);
          continue;
        }
        uploaded.push(result.filename);
      }
      if (!uploaded.length) {
        return res.status(400).json({
          success: false,
          message: errors[0] || 'Upload failed',
        });
      }
      const message =
        uploaded.length === 1
          ? 'File uploaded successfully'
          : `${uploaded.length} files uploaded successfully`;
      return res.status(201).json({
        success: true,
        message,
        data: { filenames: uploaded, filename: uploaded[0] },
      });
    } catch (err) {
      console.error('[ADMIN][FILES][UPLOAD]', err.message);
      return res.status(500).json({ success: false, message: 'Error uploading file' });
    }
  }

  async remove(req, res) {
    try {
      const filename =
        req.params.filename || req.body?.filename || req.body?.recordDelete;
      const result = deleteFile(filename);
      if (!result.ok) {
        const status = result.message.includes('not found') ? 404 : 400;
        return res.status(status).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][FILES][DELETE]', err.message);
      return res.status(500).json({ success: false, message: 'Error deleting file' });
    }
  }
}

module.exports = FileManagerController;
