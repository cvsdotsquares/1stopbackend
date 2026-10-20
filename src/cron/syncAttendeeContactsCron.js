const cron = require('node-cron');

/**
 * Sync attendee contacts cron.
 * Mirrors legacy admin/cron/sync_attendee_contacts.php
 * Note: Legacy PHP had the UPDATE query commented out.
 * This cron runs in dry-run mode by default unless SYNC_ATTENDEE_CONTACTS_APPLY=true.
 */
class SyncAttendeeContactsCron {
  constructor(pool) {
    this.pool = pool;
    this.isRunning = false;
  }

  async syncAttendeeContacts() {
    if (this.isRunning) {
      console.log('[SYNC ATTENDEE CONTACTS CRON] Previous execution still running, skipping...');
      return;
    }

    this.isRunning = true;
    const applyChanges = process.env.SYNC_ATTENDEE_CONTACTS_APPLY === 'true';

    try {
      console.log(
        `[SYNC ATTENDEE CONTACTS CRON] Scanning unlinked attendees (apply changes = ${applyChanges})...`
      );

      const [attendeeRows] = await this.pool.query(
        `SELECT id, license_number
         FROM booking_attendees
         WHERE contact_card_id = 0
           AND created > '2022-07-01'
           AND license_number IS NOT NULL
           AND TRIM(license_number) != ''
         GROUP BY license_number
         ORDER BY id DESC
         LIMIT 200`
      );

      if (!attendeeRows || attendeeRows.length === 0) {
        console.log('[SYNC ATTENDEE CONTACTS CRON] No unlinked attendees found');
        return;
      }

      let matchesFound = 0;
      let rowsUpdated = 0;

      for (const row of attendeeRows) {
        const licNumber = String(row.license_number).trim();
        if (!licNumber) continue;

        const [contactRows] = await this.pool.query(
          'SELECT id FROM booking_attendees_dropdown WHERE license_number = ? LIMIT 1',
          [licNumber]
        );

        if (contactRows && contactRows.length > 0) {
          const contactId = contactRows[0].id;
          matchesFound++;

          if (applyChanges) {
            const [updateResult] = await this.pool.query(
              'UPDATE booking_attendees SET contact_card_id = ? WHERE contact_card_id = 0 AND license_number = ?',
              [contactId, licNumber]
            );
            rowsUpdated += updateResult?.affectedRows || 0;
          }
        }
      }

      console.log(
        `[SYNC ATTENDEE CONTACTS CRON] Finished scan: ${matchesFound} licence matches found, ${rowsUpdated} booking_attendees row(s) updated`
      );
    } catch (error) {
      console.error('[SYNC ATTENDEE CONTACTS CRON] Error executing syncAttendeeContacts:', error);
    } finally {
      this.isRunning = false;
    }
  }

  start() {
    // Run weekly on Sunday at 02:00 AM
    cron.schedule('0 2 * * 0', () => {
      this.syncAttendeeContacts();
    });

    console.log('[SYNC ATTENDEE CONTACTS CRON] Scheduled to run weekly on Sunday at 02:00 AM');
  }
}

module.exports = SyncAttendeeContactsCron;
