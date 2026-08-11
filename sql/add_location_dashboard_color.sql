-- Dashboard event strip color for this location
ALTER TABLE locations
  ADD COLUMN dashboard_color VARCHAR(7) NOT NULL DEFAULT '#94a3b8'
  AFTER show_as_location_for_courses;
