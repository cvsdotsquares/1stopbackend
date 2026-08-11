const { removeExpirelocks } = require('../services/bookingService');
const { cancelAddBookingWizard } = require('../services/addBookingWizardService');
const {
  courseAvailsDashboard,
  selectFutureCourses,
  selectLocations,
  expirePromos,
  getCurrentLocksTotal,
  buildCurrentLockCountHtml,
  computeWeekSummary,
  parseViewParams,
} = require('../services/dashboardService');
const {
  showMonthDashboard,
  showMonthDashboardNew,
} = require('../services/moncalService');
const { getInProgressBookings } = require('../services/inProgressBookingsService');

function pad2(n) {
  return String(n).padStart(2, '0');
}

function syncCalendarSession(req) {
  const dateParam = req.query.date;

  if (dateParam != null && String(dateParam).trim() !== '') {
    req.session.monthCal = String(dateParam);
    req.session.yearCal = req.query.year
      ? String(req.query.year)
      : String(new Date().getFullYear());
  } else {
    const now = new Date();
    req.session.monthCal = pad2(now.getMonth() + 1);
    req.session.yearCal = String(now.getFullYear());
  }
}

function getNextMonthInfo(monthCal, yearCal) {
  const date = new Date(Number(yearCal), Number(monthCal) - 1, 1);
  date.setMonth(date.getMonth() + 1);
  return {
    nextMonth: pad2(date.getMonth() + 1),
    nextYear: date.getFullYear(),
  };
}

function parseSearchTerm(query) {
  const crs_scr =
    query.crs_scr != null && String(query.crs_scr).trim() !== ''
      ? query.crs_scr
      : '';
  const loc_scr =
    query.loc_scr != null && String(query.loc_scr).trim() !== ''
      ? query.loc_scr
      : '';
  return [crs_scr, loc_scr];
}

class DashboardController {
  constructor(pool) {
    this.pool = pool;
  }

  getAdminId(req) {
    const loggedIn = req.session?.loggedinAdmin;
    return (
      loggedIn?.admin_id || loggedIn?.id || req.session?.admin || 0
    );
  }

  async getDashboard(req, res) {
    try {
      await expirePromos(this.pool);

      if (req.session.ProcessBookings) {
        delete req.session.ProcessBookings;
      }

      syncCalendarSession(req);

      await removeExpirelocks(this.pool, req.session);

      // Leaving booking flow / opening Home: clear this admin's terminal locks.
      const adminId = this.getAdminId(req);
      if (
        req.session?.adminBooking?.lock_session?.id ||
        Number(adminId) > 0
      ) {
        await cancelAddBookingWizard(this.pool, req.session, false, adminId);
      }

      const searchterm = parseSearchTerm(req.query);
      const hasDateParam =
        req.query.date != null && String(req.query.date).trim() !== '';

      const monthCal = req.session.monthCal;
      const yearCal = req.session.yearCal;

      const [courseAvails, selectCourses, selectLocationsList, currentLocksTotal] =
        await Promise.all([
          courseAvailsDashboard(this.pool, searchterm),
          selectFutureCourses(this.pool),
          selectLocations(this.pool),
          getCurrentLocksTotal(this.pool),
        ]);

      let layout;
      let calendar;

      if (hasDateParam) {
        layout = 'selected_month';
        calendar = showMonthDashboard(monthCal, yearCal, true);
      } else {
        layout = 'current_month';
        calendar = showMonthDashboardNew();
      }

      const { nextMonth, nextYear } = getNextMonthInfo(monthCal, yearCal);
      const viewParams = parseViewParams(req.query);
      const weekSummary = computeWeekSummary(courseAvails, viewParams.anchor);

      return res.json({
        success: true,
        data: {
          layout,
          courseAvails,
          selectCourses,
          selectLocations: selectLocationsList,
          calendar: {
            ...calendar,
            nextMonth,
            nextYear,
          },
          currentLocksTotal,
          monthCal,
          yearCal,
          weekSummary,
          view: viewParams,
          filters: {
            crs_scr: searchterm[0],
            loc_scr: searchterm[1],
            date: hasDateParam ? String(req.query.date) : '',
            year: hasDateParam && req.query.year ? String(req.query.year) : '',
          },
        },
      });
    } catch (err) {
      console.error('[ADMIN][DASHBOARD]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load dashboard',
      });
    }
  }

  async getCurrentLockCount(req, res) {
    try {
      const total = await getCurrentLocksTotal(this.pool);
      return res.json({
        success: true,
        data: {
          total,
          html: buildCurrentLockCountHtml(total),
        },
      });
    } catch (err) {
      console.error('[ADMIN][DASHBOARD][LOCK-COUNT]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load lock count',
      });
    }
  }

  async getInProgressBookings(req, res) {
    try {
      const data = await getInProgressBookings(this.pool, req.session);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][DASHBOARD][IN-PROGRESS]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load in-progress bookings',
      });
    }
  }
}

module.exports = DashboardController;
