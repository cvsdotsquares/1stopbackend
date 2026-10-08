const {
  getTrainingData,
  updateTrainingData,
} = require('../services/trainingDataService');

class TrainingDataController {
  constructor(pool) {
    this.pool = pool;
  }

  async get(req, res) {
    try {
      const data = await getTrainingData(this.pool);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][TRAINING_DATA][GET]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load training data',
      });
    }
  }

  async update(req, res) {
    try {
      const result = await updateTrainingData(this.pool, req.body || {});
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][TRAINING_DATA][UPDATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error updating training data',
      });
    }
  }
}

module.exports = TrainingDataController;
