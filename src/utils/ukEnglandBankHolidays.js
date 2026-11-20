/**
 * England and Wales bank holidays from GOV.UK (england-and-wales division).
 * @see https://www.gov.uk/bank-holidays.json
 */
const GOV_UK_BANK_HOLIDAYS_URL = 'https://www.gov.uk/bank-holidays.json';

/** Fallback when offline or before first fetch (extend when publishing new years). */
const ENGLAND_BANK_HOLIDAYS_STATIC = new Set([
  '2024-01-01',
  '2024-03-29',
  '2024-04-01',
  '2024-05-06',
  '2024-05-27',
  '2024-08-26',
  '2024-12-25',
  '2024-12-26',
  '2025-01-01',
  '2025-04-18',
  '2025-04-21',
  '2025-05-05',
  '2025-05-26',
  '2025-08-25',
  '2025-12-25',
  '2025-12-26',
  '2026-01-01',
  '2026-04-03',
  '2026-04-06',
  '2026-05-04',
  '2026-05-25',
  '2026-08-31',
  '2026-12-25',
  '2026-12-28',
  '2027-01-01',
  '2027-03-26',
  '2027-03-29',
  '2027-05-03',
  '2027-05-31',
  '2027-08-30',
  '2027-12-27',
  '2027-12-28',
  '2028-01-03',
  '2028-04-14',
  '2028-04-17',
  '2028-05-01',
  '2028-05-29',
  '2028-08-28',
  '2028-12-25',
  '2028-12-26',
  '2029-01-01',
  '2029-03-30',
  '2029-04-02',
  '2029-05-07',
  '2029-05-28',
  '2029-08-27',
  '2029-12-25',
  '2029-12-26',
  '2030-01-01',
  '2030-04-19',
  '2030-04-22',
  '2030-05-06',
  '2030-05-27',
  '2030-08-26',
  '2030-12-25',
  '2030-12-26',
]);

let loadedHolidaySet = new Set(ENGLAND_BANK_HOLIDAYS_STATIC);
let lastFetchedAt = 0;
let fetchInFlight = null;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12_000;

function parseEnglandWalesDates(payload) {
  const division = payload?.['england-and-wales'];
  const events = division?.events;
  if (!Array.isArray(events)) return null;
  const dates = new Set();
  for (const ev of events) {
    const iso = String(ev?.date ?? '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      dates.add(iso);
    }
  }
  return dates.size ? dates : null;
}

async function fetchGovUkBankHolidays() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(GOV_UK_BANK_HOLIDAYS_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    const dates = parseEnglandWalesDates(data);
    if (!dates) {
      throw new Error('No england-and-wales events in response');
    }
    loadedHolidaySet = dates;
    lastFetchedAt = Date.now();
    return true;
  } catch (err) {
    console.error(
      '[BANK_HOLIDAYS] GOV.UK fetch failed, using static fallback:',
      err?.message || err
    );
    if (!loadedHolidaySet.size) {
      loadedHolidaySet = new Set(ENGLAND_BANK_HOLIDAYS_STATIC);
    }
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Load or refresh holidays (cached 24h). Safe to call on every alerts request.
 */
async function ensureEnglandBankHolidaysLoaded() {
  const stale = Date.now() - lastFetchedAt > CACHE_TTL_MS;
  if (!stale && loadedHolidaySet.size && lastFetchedAt > 0) {
    return loadedHolidaySet;
  }
  if (fetchInFlight) {
    await fetchInFlight;
    return loadedHolidaySet;
  }
  fetchInFlight = fetchGovUkBankHolidays().finally(() => {
    fetchInFlight = null;
  });
  await fetchInFlight;
  return loadedHolidaySet;
}

function isEnglandBankHoliday(isoDate) {
  const key = String(isoDate).slice(0, 10);
  return loadedHolidaySet.has(key);
}

module.exports = {
  GOV_UK_BANK_HOLIDAYS_URL,
  ensureEnglandBankHolidaysLoaded,
  isEnglandBankHoliday,
  ENGLAND_BANK_HOLIDAYS: ENGLAND_BANK_HOLIDAYS_STATIC,
};