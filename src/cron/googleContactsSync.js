// src/cron/googleContactsSync.js
// Periodic worker for processing rows in `google_contacts_sync`.
//
// Picks up entries created at least N minutes before "now" (default 15 min)
// and dispatches them to the Google People API based on `event_type`:
//   - 'insert' -> create the Google contact, store resourceName on
//                 booking_attendees_dropdown.google_profile_id
//   - 'update' -> update the Google contact identified by google_id
//   - 'delete' -> remove the Google contact identified by google_id
// In all three cases the corresponding `google_contacts_sync` row is removed
// after the operation completes successfully.

const cron = require('node-cron');
const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');

const CRON_SCHEDULE = '*/15 * * * *';
const SYNC_DELAY_MINUTES = Number(process.env.GOOGLE_CONTACTS_SYNC_DELAY_MINUTES || 15);
const LOG_PREFIX = '[GOOGLE CONTACTS CRON]';
const UPDATE_PERSON_FIELDS = 'names,emailAddresses,phoneNumbers,biographies';
const READ_PERSON_FIELDS = 'names,emailAddresses,phoneNumbers,biographies,metadata';

function getAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    console.warn(`${LOG_PREFIX} Google OAuth env vars missing (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REFRESH_TOKEN); cron will fail to authenticate.`);
  }
  const client = new OAuth2Client(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

function log(...args) {
  console.log(LOG_PREFIX, ...args);
}
function logWarn(...args) {
  console.warn(LOG_PREFIX, ...args);
}
function logError(...args) {
  console.error(LOG_PREFIX, ...args);
}

function normalizeError(error) {
  if (!error) return { message: 'Unknown error' };
  if (error.response && error.response.data) return error.response.data;
  if (error.message) return { message: error.message };
  return { message: String(error) };
}

function buildPersonPayload(attendee) {
  const givenName = (attendee.first_name || '').trim();
  const familyName = (attendee.sur_name || '').trim();
  const displayName = `${givenName} ${familyName}`.trim();

  const payload = {};

  if (givenName || familyName) {
    payload.names = [{
      givenName,
      familyName,
      ...(displayName ? { displayName } : {})
    }];
  }

  if (attendee.email) {
    payload.emailAddresses = [{ value: String(attendee.email).trim() }];
  }

  const phones = [];
  if (attendee.contact1) phones.push({ value: String(attendee.contact1).trim(), type: 'mobile' });
  if (attendee.contact2) phones.push({ value: String(attendee.contact2).trim(), type: 'other' });
  if (phones.length) payload.phoneNumbers = phones;

  if (attendee.booking_ref) {
    payload.biographies = [{
      value: `Booking Ref: ${attendee.booking_ref}`,
      contentType: 'TEXT_PLAIN'
    }];
  }

  return payload;
}

async function fetchAttendee(pool, contactId) {
  const [rows] = await pool.query(
    `SELECT id, first_name, sur_name, contact1, contact2, email, booking_ref
     FROM booking_attendees_dropdown
     WHERE id = ?
     LIMIT 1`,
    [contactId]
  );
  return rows[0] || null;
}

async function deleteSyncRow(pool, syncId) {
  await pool.query('DELETE FROM google_contacts_sync WHERE id = ?', [syncId]);
}

async function handleInsert(pool, peopleApi, syncRow) {
  const attendee = await fetchAttendee(pool, syncRow.contact_id);
  if (!attendee) {
    logWarn(`[INSERT] booking_attendees_dropdown row not found (contact_id=${syncRow.contact_id}); dropping sync row id=${syncRow.id}`);
    await deleteSyncRow(pool, syncRow.id);
    return;
  }

  const payload = buildPersonPayload(attendee);
  log(`[INSERT] Creating Google contact (sync_id=${syncRow.id}, contact_id=${attendee.id}, booking_ref=${attendee.booking_ref || 'N/A'})`);

  const res = await peopleApi.people.createContact({
    requestBody: payload,
    personFields: UPDATE_PERSON_FIELDS
  });

  const resourceName = res?.data?.resourceName;
  if (!resourceName) {
    throw new Error('createContact did not return a resourceName');
  }

  await pool.query(
    'UPDATE booking_attendees_dropdown SET google_profile_id = ? WHERE id = ?',
    [resourceName, attendee.id]
  );
  await deleteSyncRow(pool, syncRow.id);

  log(`[INSERT] OK resourceName=${resourceName} stored as google_profile_id for contact_id=${attendee.id}; sync_id=${syncRow.id} removed`);
}

async function handleUpdate(pool, peopleApi, syncRow) {
  const attendee = await fetchAttendee(pool, syncRow.contact_id);
  if (!attendee) {
    logWarn(`[UPDATE] booking_attendees_dropdown row not found (contact_id=${syncRow.contact_id}); dropping sync row id=${syncRow.id}`);
    await deleteSyncRow(pool, syncRow.id);
    return;
  }

  const resourceName = syncRow.google_id;
  if (!resourceName) {
    logWarn(`[UPDATE] Missing google_id for sync row id=${syncRow.id} (contact_id=${attendee.id}); dropping sync row`);
    await deleteSyncRow(pool, syncRow.id);
    return;
  }

  log(`[UPDATE] Fetching latest etag for ${resourceName} (sync_id=${syncRow.id}, contact_id=${attendee.id})`);
  const latest = await peopleApi.people.get({
    resourceName,
    personFields: READ_PERSON_FIELDS
  });

  const payload = buildPersonPayload(attendee);
  payload.etag = latest?.data?.etag;

  log(`[UPDATE] Updating Google contact ${resourceName} (sync_id=${syncRow.id}, contact_id=${attendee.id}, booking_ref=${attendee.booking_ref || 'N/A'})`);
  await peopleApi.people.updateContact({
    resourceName,
    requestBody: payload,
    updatePersonFields: UPDATE_PERSON_FIELDS,
    personFields: UPDATE_PERSON_FIELDS
  });

  await deleteSyncRow(pool, syncRow.id);
  log(`[UPDATE] OK resourceName=${resourceName} updated for contact_id=${attendee.id}; sync_id=${syncRow.id} removed`);
}

async function handleDelete(pool, peopleApi, syncRow) {
  const resourceName = syncRow.google_id;
  if (!resourceName) {
    logWarn(`[DELETE] Missing google_id for sync row id=${syncRow.id} (contact_id=${syncRow.contact_id}); nothing to delete in Google. Dropping sync row.`);
    await deleteSyncRow(pool, syncRow.id);
    return;
  }

  log(`[DELETE] Deleting Google contact ${resourceName} (sync_id=${syncRow.id}, contact_id=${syncRow.contact_id})`);
  try {
    await peopleApi.people.deleteContact({ resourceName });
  } catch (err) {
    const normalized = normalizeError(err);
    const status = Number(normalized.code || normalized.status || 0);
    if (status === 404) {
      logWarn(`[DELETE] Google contact ${resourceName} not found (already deleted). Continuing.`);
    } else {
      throw err;
    }
  }

  await deleteSyncRow(pool, syncRow.id);
  log(`[DELETE] OK resourceName=${resourceName} removed from Google; sync_id=${syncRow.id} removed`);
}

async function processSyncRow(pool, peopleApi, syncRow) {
  const eventType = String(syncRow.event_type || '').toLowerCase();
  try {
    if (eventType === 'insert') {
      await handleInsert(pool, peopleApi, syncRow);
    } else if (eventType === 'update') {
      await handleUpdate(pool, peopleApi, syncRow);
    } else if (eventType === 'delete') {
      await handleDelete(pool, peopleApi, syncRow);
    } else {
      logWarn(`Unknown event_type='${syncRow.event_type}' for sync row id=${syncRow.id}; dropping`);
      await deleteSyncRow(pool, syncRow.id);
    }
  } catch (error) {
    const normalized = normalizeError(error);
    logError(
      `Failed to process sync row id=${syncRow.id} (contact_id=${syncRow.contact_id}, event_type=${syncRow.event_type}, google_id=${syncRow.google_id || 'N/A'}):`,
      normalized
    );
  }
}

class GoogleContactsSyncCron {
  constructor(pool) {
    this.pool = pool;
    this.authClient = getAuthClient();
    this.isRunning = false;
  }

  async syncPendingContacts() {
    if (this.isRunning) {
      logWarn('Previous run still in progress; skipping this tick.');
      return;
    }
    this.isRunning = true;
    const startedAt = Date.now();

    try {
      let rows;
      try {
        const [result] = await this.pool.query(
          `SELECT id, contact_id, event_type, google_id
           FROM google_contacts_sync
           WHERE created >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
           ORDER BY id ASC`,
          [SYNC_DELAY_MINUTES]
        );
        rows = result;
        console.log('[GOOGLE CONTACTS SYNC] Rows:', rows);
      } catch (error) {
        logError('Failed to load pending sync rows:', error);
        return;
      }

      if (!rows.length) {
        log(`No sync rows older than ${SYNC_DELAY_MINUTES} minute(s) to process`);
        return;
      }

      log(`Picked up ${rows.length} sync row(s) older than ${SYNC_DELAY_MINUTES} minute(s); starting processing...`);

      const peopleApi = google.people({ version: 'v1', auth: this.authClient });

      let processed = 0;
      for (const row of rows) {
        await processSyncRow(this.pool, peopleApi, row);
        processed += 1;
      }

      log(`Processed ${processed}/${rows.length} sync row(s) in ${Date.now() - startedAt}ms`);
    } finally {
      this.isRunning = false;
    }
  }

  start() {
    cron.schedule(CRON_SCHEDULE, () => {
      log('Running scheduled sync...');
      this.syncPendingContacts().catch((error) => {
        logError('Unhandled error in syncPendingContacts:', error);
      });
    });
    log(`Scheduled at cron pattern: ${CRON_SCHEDULE} (delay window: ${SYNC_DELAY_MINUTES} min)`);
  }
}

module.exports = GoogleContactsSyncCron;
