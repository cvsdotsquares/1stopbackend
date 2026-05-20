// src/cron/googleContactsSync.js
// Periodic worker for processing google_contacts_sync rows.
// This is intentionally simple / low-volume, similar to the cleanup cron jobs.
const cron = require('node-cron');
const { google } = require('googleapis');
const { getAuthClient } = require('../lib/oauth');

const CRON_SCHEDULE = process.env.GOOGLE_CONTACTS_CRON_SCHEDULE || '*/15 * * * *';
const STATUS_PENDING = 1;

function mapPersonPayload(attendee) {
  const names = [];
  if (attendee.first_name || attendee.last_name || attendee.full_name) {
    names.push({
      givenName: attendee.first_name || '',
      familyName: attendee.last_name || '',
      displayName: attendee.full_name || ((attendee.first_name || '') + ' ' + (attendee.last_name || '')).trim()
    });
  }

  const emailAddresses = attendee.email ? [{ value: attendee.email }] : [];
  const phoneNumbers = attendee.phone ? [{ value: attendee.phone }] : [];
  const addresses = (attendee.address1 || attendee.city || attendee.region || attendee.postcode || attendee.country) ? [{
    streetAddress: attendee.address1 || '',
    city: attendee.city || '',
    region: attendee.region || '',
    postalCode: attendee.postcode || '',
    country: attendee.country || ''
  }] : [];
  const organizations = (attendee.organization_name || attendee.job_title) ? [{
    name: attendee.organization_name || '',
    title: attendee.job_title || ''
  }] : [];
  const userDefined = [];
  if (attendee.id) userDefined.push({ key: 'local_contact_id', value: String(attendee.id) });
  if (attendee.license_number) userDefined.push({ key: 'license_number', value: String(attendee.license_number) });

  const payload = {};
  if (names.length) payload.names = names;
  if (emailAddresses.length) payload.emailAddresses = emailAddresses;
  if (phoneNumbers.length) payload.phoneNumbers = phoneNumbers;
  if (addresses.length) payload.addresses = addresses;
  if (organizations.length) payload.organizations = organizations;
  if (userDefined.length) payload.userDefined = userDefined;
  return payload;
}

function normalizeError(error) {
  if (!error) return { message: 'Unknown error' };
  if (error.response && error.response.data) {
    return error.response.data;
  }
  if (error.message) {
    return { message: error.message };
  }
  return { message: String(error) };
}

function isPermanentError(errorBody) {
  const status = errorBody?.status || errorBody?.code || null;
  if (!status) return false;
  const statusCode = Number(status);
  return Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 500 && statusCode !== 429;
}

async function archiveSyncResult(pool, meta) {
  const sql = `INSERT INTO google_contacts_sync_after_synced
    (contact_id, event_type, google_id, status)
    VALUES (?, ?, ?, ?)`;
  const params = [
    meta.contact_id || null,
    meta.event_type || null,
    meta.google_id || null,
    meta.status || STATUS_PENDING
  ];
  try {
    await pool.query(sql, params);
  } catch (e) {
    console.warn('[GOOGLE CONTACTS CRON] Could not archive sync result:', e.message || e);
  }
}

async function markSyncRowDone(pool, syncId, meta) {
  const googleId = meta.google_id || null;
  await archiveSyncResult(pool, Object.assign({}, meta, { sync_id: syncId, status: STATUS_PENDING, google_id: googleId }));
  await pool.query('DELETE FROM google_contacts_sync WHERE id = ?', [syncId]);
}

async function markSyncRowFailed(pool, syncRow, errorBody) {
  const permanent = isPermanentError(errorBody);
  if (permanent) {
    await archiveSyncResult(pool, {
      contact_id: syncRow.contact_id,
      event_type: syncRow.event_type,
      google_id: syncRow.google_id || null,
      status: STATUS_PENDING
    });
    await pool.query('DELETE FROM google_contacts_sync WHERE id = ?', [syncRow.id]);
  } else {
    console.error('[GOOGLE CONTACTS CRON] Transient error, leaving sync row for retry:', normalizeError(errorBody));
  }
}

async function getPendingRows(connection) {
  const [rows] = await connection.query(
    `SELECT id, contact_id, event_type, google_id, created
     FROM google_contacts_sync
     WHERE status = ?
     ORDER BY id
     FOR UPDATE`,
    [STATUS_PENDING]
  );
  return rows;
}

async function acquirePendingRows(connection, rows) {
  return rows;
}

async function processSyncRow(pool, syncRow, authClient) {
  const people = google.people({ version: 'v1', auth: authClient });
  const contactId = syncRow.contact_id;
  if (!contactId) {
    await markSyncRowFailed(pool, syncRow, { message: 'Missing contact_id in sync row' });
    return;
  }

  const [attendeeRows] = await pool.query('SELECT * FROM booking_attendees_dropdown WHERE id = ? LIMIT 1', [contactId]);
  const attendee = attendeeRows[0];
  if (!attendee) {
    await markSyncRowFailed(pool, syncRow, { message: 'booking_attendees_dropdown row not found', contact_id: contactId });
    return;
  }

  const eventType = String(syncRow.event_type || '').toLowerCase();
  const personPayload = mapPersonPayload(attendee);

  async function updateAttendeeEtag(resourceName, responseData) {
    const etag = responseData?.metadata?.sources?.[0]?.etag || null;
    if (etag !== null) {
      await pool.query('UPDATE booking_attendees_dropdown SET google_profile_etag = ? WHERE id = ?', [etag, attendee.id]);
    }
  }

  try {
    if (eventType === 'create') {
      if (attendee.google_profile_id) {
        return await processSyncRow(pool, Object.assign({}, syncRow, { event_type: 'update' }), authClient);
      }
      const res = await people.people.createContact({
        requestBody: personPayload,
        personFields: 'names,emailAddresses,phoneNumbers,addresses,organizations,userDefined,metadata'
      });
      const resourceName = res?.data?.resourceName;
      const etag = res?.data?.metadata?.sources?.[0]?.etag || null;
      if (!resourceName) {
        throw { message: 'createContact did not return resourceName', response: res?.data };
      }
      await pool.query('UPDATE booking_attendees_dropdown SET google_profile_id = ?, google_profile_etag = ? WHERE id = ?', [resourceName, etag, attendee.id]);
      await markSyncRowDone(pool, syncRow.id, {
        contact_id: attendee.id,
        event_type: eventType,
        google_id: resourceName,
        google_resource: resourceName,
        response_json: res.data,
        status: STATUS_PENDING
      });

    } else if (eventType === 'update') {
      const resourceName = syncRow.google_id || attendee.google_profile_id;
      if (!resourceName) {
        return await processSyncRow(pool, Object.assign({}, syncRow, { event_type: 'create' }), authClient);
      }

      try {
        const res = await people.people.updateContact({
          resourceName,
          requestBody: personPayload,
          updatePersonFields: Object.keys(personPayload).join(','),
          personFields: 'names,emailAddresses,phoneNumbers,addresses,organizations,userDefined,metadata'
        });
        await updateAttendeeEtag(resourceName, res.data);
        await markSyncRowDone(pool, syncRow.id, {
          contact_id: attendee.id,
          event_type: eventType,
          google_id: resourceName,
          google_resource: resourceName,
          response_json: res.data,
          status: STATUS_PENDING
        });
      } catch (err) {
        const normalized = normalizeError(err);
        const statusCode = Number(normalized.status || normalized.code || 0);
        if (statusCode === 400 && JSON.stringify(normalized).includes('failedPrecondition')) {
          try {
            const latest = await people.people.get({
              resourceName,
              personFields: 'names,emailAddresses,phoneNumbers,addresses,organizations,userDefined,metadata'
            });
            const merged = Object.assign({}, latest.data, personPayload);
            const retryRes = await people.people.updateContact({
              resourceName,
              requestBody: merged,
              updatePersonFields: Object.keys(personPayload).join(','),
              personFields: 'names,emailAddresses,phoneNumbers,addresses,organizations,userDefined,metadata'
            });
            await updateAttendeeEtag(resourceName, retryRes.data);
            await markSyncRowDone(pool, syncRow.id, {
              contact_id: attendee.id,
              event_type: eventType,
              google_id: resourceName,
              google_resource: resourceName,
              response_json: retryRes.data,
              status: STATUS_PENDING
            });
            return;
          } catch (retryErr) {
            await markSyncRowFailed(pool, syncRow, normalizeError(retryErr));
            return;
          }
        }
        await markSyncRowFailed(pool, syncRow, normalized);
      }

    } else if (eventType === 'delete') {
      const resourceName = syncRow.google_id || attendee.google_profile_id;
      if (!resourceName) {
        await markSyncRowDone(pool, syncRow.id, {
          contact_id: attendee.id,
          event_type: eventType,
          response_json: { message: 'Nothing to delete' },
          status: STATUS_PENDING
        });
        return;
      }
      try {
        await people.people.deleteContact({ resourceName });
        await pool.query('UPDATE booking_attendees_dropdown SET google_profile_id = NULL, google_profile_etag = NULL WHERE id = ?', [attendee.id]);
        await markSyncRowDone(pool, syncRow.id, {
          contact_id: attendee.id,
          event_type: eventType,
          google_id: resourceName,
          google_resource: resourceName,
          response_json: { message: 'deleted' },
          status: STATUS_PENDING
        });
      } catch (err) {
        await markSyncRowFailed(pool, syncRow, normalizeError(err));
      }

    } else {
      await markSyncRowFailed(pool, syncRow, { message: 'Unknown event_type', value: syncRow.event_type });
    }
  } catch (error) {
    await markSyncRowFailed(pool, syncRow, normalizeError(error));
  }
}

class GoogleContactsSyncCron {
  constructor(pool) {
    this.pool = pool;
    this.authClient = getAuthClient();
  }

  async syncPendingContacts() {
    const connection = await this.pool.getConnection();
    let pendingRows = [];
    try {
      pendingRows = await getPendingRows(connection);
      if (!pendingRows.length) {
        await connection.commit();
        console.log('[GOOGLE CONTACTS CRON] No pending sync rows');
        return;
      }
      await acquirePendingRows(connection, pendingRows);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      console.error('[GOOGLE CONTACTS CRON] Failed to acquire pending rows:', error);
      return;
    } finally {
      connection.release();
    }

    for (const row of pendingRows) {
      try {
        await processSyncRow(this.pool, row, this.authClient);
      } catch (error) {
        console.error('[GOOGLE CONTACTS CRON] Error processing sync row', row.id, error);
      }
    }

    console.log(`[GOOGLE CONTACTS CRON] Processed ${pendingRows.length} row(s)`);
  }

  start() {
    cron.schedule(CRON_SCHEDULE, () => {
      console.log('[GOOGLE CONTACTS CRON] Running scheduled sync...');
      this.syncPendingContacts();
    });
    console.log(`[GOOGLE CONTACTS CRON] Scheduled to run at cron pattern: ${CRON_SCHEDULE}`);
  }
}

module.exports = GoogleContactsSyncCron;
