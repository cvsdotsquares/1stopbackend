const {
  getDailyItinerary,
  saveDayNote,
  saveStudentResults,
} = require('../services/itineraryService');

class ItineraryController {
  constructor(pool) {
    this.pool = pool;
  }

  getAdminSession(req) {
    return req.session?.loggedinAdmin || {};
  }

  async getDayPage(req, res) {
    try {
      const day = req.query.day || req.query.date || null;
      const data = await getDailyItinerary(this.pool, day);
      return res.json({ success: true, data });
    } catch (err) {
      const status = err.status || 500;
      console.error('[ADMIN][ITINERARY][DAY]', err.message);
      return res.status(status).json({
        success: false,
        message: err.message || 'Unable to load daily itinerary',
      });
    }
  }

  async saveDayNote(req, res) {
    try {
      const day =
        req.body?.date_day_note_save ||
        req.body?.day ||
        req.query.day ||
        null;
      const note = req.body?.day_note ?? '';
      const data = await saveDayNote(this.pool, day, note);
      return res.json({ success: true, data, message: data.message });
    } catch (err) {
      const status = err.status || 500;
      console.error('[ADMIN][ITINERARY][DAY-NOTE]', err.message);
      return res.status(status).json({
        success: false,
        message: err.message || 'Unable to save day note',
      });
    }
  }

  async saveStudentResults(req, res) {
    try {
      const data = await saveStudentResults(
        this.pool,
        req.body?.day_result_save || req.query.day,
        req.body || {},
        this.getAdminSession(req)
      );
      return res.json({ success: true, data, message: data.message });
    } catch (err) {
      const status = err.status || 500;
      console.error('[ADMIN][ITINERARY][RESULTS]', err.message);
      return res.status(status).json({
        success: false,
        message: err.message || 'Unable to save student results',
      });
    }
  }
}

module.exports = ItineraryController;
