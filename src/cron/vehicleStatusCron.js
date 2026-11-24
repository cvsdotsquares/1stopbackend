const cron = require('node-cron');
const { setVehicleColors } = require('../admin/services/vehicleColorService');

/**
 * Vehicle status color recalculation cron.
 * Mirrors legacy admin/cron/vehicle_update_status_cron.php
 * Recalculates mot_color, road_tax_color, service_color, and issue_color across all vehicles.
 */
class VehicleStatusCron {
  constructor(pool) {
    this.pool = pool;
    this.isRunning = false;
  }

  async updateVehicleStatuses() {
    if (this.isRunning) {
      console.log('[VEHICLE STATUS CRON] Previous execution still running, skipping...');
      return;
    }

    this.isRunning = true;
    try {
      console.log('[VEHICLE STATUS CRON] Recalculating fleet vehicle status colors...');

      const [vehicles] = await this.pool.query('SELECT id, registration FROM vehicles');

      if (!vehicles || vehicles.length === 0) {
        console.log('[VEHICLE STATUS CRON] No vehicles found in database');
        return;
      }

      let updatedCount = 0;
      for (const vehicle of vehicles) {
        try {
          await setVehicleColors(this.pool, vehicle.id);
          updatedCount++;
        } catch (vErr) {
          console.error(
            `[VEHICLE STATUS CRON] Error updating vehicle #${vehicle.id} (${vehicle.registration || 'N/A'}):`,
            vErr.message
          );
        }
      }

      console.log(
        `[VEHICLE STATUS CRON] Successfully recalculated status colors for ${updatedCount} vehicle(s)`
      );
    } catch (error) {
      console.error('[VEHICLE STATUS CRON] Error in updateVehicleStatuses:', error);
    } finally {
      this.isRunning = false;
    }
  }

  start() {
    // Run daily at 01:00 AM
    cron.schedule('0 1 * * *', () => {
      this.updateVehicleStatuses();
    });

    console.log('[VEHICLE STATUS CRON] Scheduled to run daily at 01:00 AM');
  }
}

module.exports = VehicleStatusCron;
