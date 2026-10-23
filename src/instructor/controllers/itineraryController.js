const {
  getInstructorDailyItinerary,
  getInstructorResultsPage,
  saveInstructorResults,
  getPreviousResultsByLicence,
  getClientDetails,
  updateClientDetails,
} = require('../services/instructorItineraryService');

class InstructorItineraryController {
  constructor(pool) {
    this.pool = pool;
  }

  async getToday(req, res) {
    try {
      const instructorId = req.session?.instructor_id;
      const data = await getInstructorDailyItinerary(this.pool, undefined, instructorId);

      return res.json({
        success: true,
        data,
      });
    } catch (err) {
      console.error('[INSTRUCTOR][ITINERARY][GET_TODAY]', err);
      return res.status(500).json({
        success: false,
        message: 'Failed to load itinerary schedule',
      });
    }
  }

  async getResults(req, res) {
    try {
      const dayParam = req.query.day;
      const data = await getInstructorResultsPage(this.pool, dayParam);

      return res.json({
        success: true,
        data,
      });
    } catch (err) {
      console.error('[INSTRUCTOR][ITINERARY][GET_RESULTS]', err);
      return res.status(500).json({
        success: false,
        message: 'Failed to load results update page',
      });
    }
  }

  async saveResults(req, res) {
    try {
      const dayParam = req.query.day || req.body?.day_result_save;
      const result = await saveInstructorResults(
        this.pool,
        dayParam,
        req.body || {},
        req.session
      );

      return res.json({
        success: true,
        message: result.message,
        data: result,
      });
    } catch (err) {
      console.error('[INSTRUCTOR][ITINERARY][SAVE_RESULTS]', err);
      return res.status(500).json({
        success: false,
        message: 'Failed to save student results',
      });
    }
  }

  async getPreviousResults(req, res) {
    try {
      const licence = req.query.licence;
      if (!licence) {
        return res.status(400).json({
          success: false,
          message: 'Licence number parameter is required',
        });
      }

      const result = await getPreviousResultsByLicence(this.pool, licence);
      if (!result.ok) {
        return res.status(400).json({
          success: false,
          message: result.message,
        });
      }

      return res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      console.error('[INSTRUCTOR][ITINERARY][PREVIOUS_RESULTS]', err);
      return res.status(500).json({
        success: false,
        message: 'Failed to load previous results',
      });
    }
  }

  async getAttendee(req, res) {
    try {
      const bid = req.params.bid;
      const result = await getClientDetails(this.pool, bid);

      if (!result.ok) {
        return res.status(404).json({
          success: false,
          message: result.message,
        });
      }

      return res.json({
        success: true,
        data: result.attendee,
      });
    } catch (err) {
      console.error('[INSTRUCTOR][ITINERARY][GET_ATTENDEE]', err);
      return res.status(500).json({
        success: false,
        message: 'Failed to load attendee details',
      });
    }
  }

  async updateAttendee(req, res) {
    try {
      const bid = req.params.bid;
      const result = await updateClientDetails(this.pool, bid, req.body || {});

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
      console.error('[INSTRUCTOR][ITINERARY][UPDATE_ATTENDEE]', err);
      return res.status(500).json({
        success: false,
        message: 'Failed to update attendee details',
      });
    }
  }
}

module.exports = InstructorItineraryController;
