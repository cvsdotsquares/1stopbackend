const {
  getItineraryDay,
  saveDayNote,
  saveStudentResults,
} = require('../services/itineraryDayService');

class ItineraryController {
  constructor(pool) {
    this.pool = pool;
  }

  async getDay(req, res) {
    try {
      const data = await getItineraryDay(this.pool, { day: req.query.day });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][ITINERARY][DAY]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load itinerary day',
      });
    }
  }

  async saveDayNote(req, res) {
    try {
      const day = req.body?.date_day_note_save || req.body?.day;
      if (!day) {
        return res.status(400).json({
          success: false,
          message: 'Day note can not be left blank',
        });
      }

      const result = await saveDayNote(this.pool, day, req.body?.day_note);
      if (!result.ok) {
        return res.status(400).json({
          success: false,
          message: result.message,
        });
      }

      return res.json({
        success: true,
        message: result.message,
      });
    } catch (err) {
      console.error('[ADMIN][ITINERARY][DAY-NOTE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in updating',
      });
    }
  }

  async saveStudentResults(req, res) {
    try {
      const day = req.body?.day_result_save || req.query?.day;
      const result = await saveStudentResults(this.pool, day, req.body, req.session);
      return res.json({
        success: true,
        message: result.message,
      });
    } catch (err) {
      console.error('[ADMIN][ITINERARY][STUDENT-RESULTS]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to save student results',
      });
    }
  }
}

module.exports = ItineraryController;
