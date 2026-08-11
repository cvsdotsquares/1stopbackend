-- Show as a location for Courses (default ON so existing locations keep working)
ALTER TABLE locations
  ADD COLUMN show_as_location_for_courses TINYINT NOT NULL DEFAULT 1
  AFTER show_in_vehicle_schedule;
