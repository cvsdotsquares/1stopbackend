function pad2(n) {
  return String(n).padStart(2, '0');
}

function toYmd(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function daysInMonth(month, year) {
  const m = month == null ? new Date().getMonth() + 1 : Number(month);
  const y = year == null ? new Date().getFullYear() : Number(year);
  return new Date(y, m, 0).getDate();
}

function weeksInMonth(month = null, year = null) {
  const y = year == null ? new Date().getFullYear() : Number(year);
  const m = month == null ? new Date().getMonth() + 1 : Number(month);
  const daysInMonths = daysInMonth(m, y);
  let numOfweeks =
    (daysInMonths % 7 === 0 ? 0 : 1) + Math.floor(daysInMonths / 7);
  const monthEndingDay = new Date(y, m - 1, daysInMonths).getDay() || 7;
  const monthStartDay = new Date(y, m - 1, 1).getDay() || 7;

  if (monthEndingDay < monthStartDay) {
    numOfweeks++;
  }

  return numOfweeks;
}

function getStartOfWeekDate(dateInput = null) {
  const date = dateInput ? new Date(dateInput) : new Date();
  date.setHours(0, 0, 0, 0);
  const day = date.getDay() || 7;
  if (day === 1) {
    return date;
  }
  const monday = new Date(date);
  monday.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function getDatesFromRange(start, end, format = 'Y-m-d') {
  const array = [];
  const intervalMs = 24 * 60 * 60 * 1000;
  const startDate = new Date(start);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(end);
  endDate.setHours(0, 0, 0, 0);
  endDate.setDate(endDate.getDate() + 1);

  for (let d = new Date(startDate); d < endDate; d.setDate(d.getDate() + 1)) {
    if (format === 'Y-m-d') {
      array.push(toYmd(d));
    } else {
      array.push(d.toISOString());
    }
  }
  return array;
}

function createShowDayState(month, year) {
  return {
    currentDay: 0,
    month: Number(month),
    year: Number(year),
    showDay(cellNumber) {
      if (this.currentDay === 0) {
        const firstDayOfTheWeek = new Date(
          this.year,
          this.month - 1,
          1
        ).getDay();
        const firstMondayBased = firstDayOfTheWeek === 0 ? 7 : firstDayOfTheWeek;
        if (Number(cellNumber) === firstMondayBased) {
          this.currentDay = 1;
        }
      }

      const dim = daysInMonth(this.month, this.year);
      if (this.currentDay !== 0 && this.currentDay <= dim) {
        const cellContent = pad2(this.currentDay);
        this.currentDay++;
        return cellContent;
      }
      return null;
    },
  };
}

/**
 * Port of Moncal::showMonth_dashboard($month, $year, $exWeek)
 */
function showMonthDashboard(month = null, year = null, exWeek = false) {
  const m = month == null ? pad2(new Date().getMonth() + 1) : String(month);
  const y = year == null ? String(new Date().getFullYear()) : String(year);
  const monthNum = Number(m);
  const yearNum = Number(y);

  const monthWeekcount = weeksInMonth(monthNum, yearNum);
  const daysInMonths = daysInMonth(monthNum, yearNum);
  const dayArrayMain = [];
  const mWeek = exWeek ? monthWeekcount + 3 : monthWeekcount;

  const state = createShowDayState(monthNum, yearNum);

  for (let w = 0; w < mWeek; w++) {
    let p;
    if (w >= monthWeekcount) {
      p = w - monthWeekcount;
    } else {
      p = w;
    }

    if (monthWeekcount === w) {
      state.currentDay = 0;
      if (state.month === 12) {
        state.month = 1;
        state.year = yearNum + 1;
      } else {
        state.month = monthNum + 1;
      }
    }

    dayArrayMain[w] = [];
    for (let j = 1; j <= 7; j++) {
      const d = state.showDay(p * 7 + j);
      if (
        state.month === monthNum ||
        d == null ||
        Number(d) < 15
      ) {
        dayArrayMain[w].push(d);
      }
    }
  }

  return {
    dayArrayMain,
    calMonth: monthNum,
    calYear: yearNum,
    daysInMonths,
    monthWeekcount,
  };
}

/**
 * Port of Moncal::showMonth_dashboard_new()
 */
function showMonthDashboardNew() {
  const month = Number(new Date().getMonth() + 1);
  const year = Number(new Date().getFullYear());
  const currDate = toYmd(new Date());

  const monthWeekcount = weeksInMonth(month, year);
  const daysInMonths = daysInMonth(month, year);

  const startOfWeekDate = getStartOfWeekDate(currDate);
  const startDate = toYmd(startOfWeekDate);
  const endDateObj = new Date(startDate);
  endDateObj.setDate(endDateObj.getDate() + 41);
  const endDate = toYmd(endDateObj);

  const datesArray = getDatesFromRange(startDate, endDate);
  const result = [];
  let temp = [];
  const newMonthIndex = {};
  let counter = 1;
  let remaining = 0;

  for (const date of datesArray) {
    const monthEnd = daysInMonth(
      new Date(date).getMonth() + 1,
      new Date(date).getFullYear()
    );
    const currentDay = new Date(date).getDate();

    if (remaining) {
      for (let i = 0; i < remaining; i++) {
        temp.push(null);
        counter++;
      }
      remaining = 0;
    }

    if (monthEnd === currentDay) {
      temp.push(date);
      if (7 - counter > 0) {
        remaining = counter;
      }
      for (let i = 0; i < 7 - counter; i++) {
        temp.push(null);
      }
      counter = 7;
    } else {
      temp.push(date);
    }

    if (counter === 7) {
      result.push(temp);
      temp = [];
      counter = 1;
    } else {
      counter++;
    }
  }

  let isCalendarStart = 0;
  if (result[1]) {
    for (const va of result[1]) {
      if (va === '' || va == null) {
        if (result[1].includes(currDate)) {
          delete result[0];
          isCalendarStart = 1;
        }
      }
    }
  }

  const weekKeys = Object.keys(result)
    .map(Number)
    .sort((a, b) => a - b);
  const firstWeek = result[weekKeys[0]];
  let starting_date = firstWeek ? firstWeek[0] : startDate;

  for (const k of weekKeys) {
    const v = result[k];
    for (const va of v) {
      if (va && va !== '' && new Date(va).getDate() === 1) {
        if (isCalendarStart === 1) {
          starting_date = va;
          isCalendarStart = 0;
        } else {
          newMonthIndex[k] = va;
        }
      }
    }
  }

  const normalizedDayArrayMain = {};
  for (const k of weekKeys) {
    normalizedDayArrayMain[k] = result[k];
  }

  return {
    dayArrayMain: normalizedDayArrayMain,
    calMonth: month,
    calYear: year,
    daysInMonths,
    monthWeekcount,
    newMonthIndex,
    starting_date,
  };
}

module.exports = {
  showMonthDashboard,
  showMonthDashboardNew,
  daysInMonth,
};
