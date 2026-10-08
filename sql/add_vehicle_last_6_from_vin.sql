-- Last 6 characters of VIN (numeric) on fleet vehicles
ALTER TABLE vehicles
  ADD COLUMN last_6_from_vin VARCHAR(6) NULL DEFAULT NULL AFTER registration;
