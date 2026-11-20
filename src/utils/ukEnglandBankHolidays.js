/**
 * England and Wales bank holidays from GOV.UK (england-and-wales division).
 * @see https://www.gov.uk/bank-holidays.json
 */
const GOV_UK_BANK_HOLIDAYS_URL = 'https://www.gov.uk/bank-holidays.json';

let loadedHolidaySet = new Set();
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
      '[BANK_HOLIDAYS] GOV.UK fetch failed:',
      err?.message || err
    );
  } finally {
    clearTimeout(timer);
  }
  return false;
}

/**
 * Load or refresh holidays (cached 24h). Safe to call on every alerts request.
 * Bank holidays are only known after a successful GOV.UK fetch (no static list).
 */
async function ensureEnglandBankHolidaysLoaded() {
  const stale = Date.now() - lastFetchedAt > CACHE_TTL_MS;
  const needsFetch =
  !loadedHolidaySet.size || lastFetchedAt === 0 || stale;

  if (!needsFetch) {
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
};