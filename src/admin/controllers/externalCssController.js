const { readExternalCss, saveExternalCss } = require('../services/externalCssService');

class ExternalCssController {
  async get(req, res) {
    try {
      const result = await readExternalCss();
      return res.json({
        success: true,
        data: {
          content: result.content,
          path: result.path,
          exists: result.exists,
        },
      });
    } catch (err) {
      console.error('[ADMIN][EXTERNAL_CSS][GET]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to read external CSS' });
    }
  }

  async save(req, res) {
    try {
      const result = await saveExternalCss(req.body || {});
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message, data: { path: result.path } });
    } catch (err) {
      console.error('[ADMIN][EXTERNAL_CSS][SAVE]', err.message);
      return res.status(500).json({ success: false, message: 'Error saving external CSS' });
    }
  }
}

module.exports = ExternalCssController;
