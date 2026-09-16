-- Booking Hold Management: keep bookings.status unchanged (PHP-safe).
-- on_hold = 1 means the booking is paused, capacity is released, and auto-comms are skipped.

ALTER TABLE bookings
  ADD COLUMN on_hold TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1=held: capacity released, skip auto-comms'
    AFTER refundable,
  ADD COLUMN on_hold_at DATETIME NULL DEFAULT NULL AFTER on_hold,
  ADD COLUMN on_hold_by_admin_id INT NOT NULL DEFAULT 0 AFTER on_hold_at,
  ADD COLUMN held_course_event_id INT NULL DEFAULT NULL
    COMMENT 'course_event_id at the time of hold'
    AFTER on_hold_by_admin_id;

CREATE TABLE IF NOT EXISTS booking_hold_history (
  id INT NOT NULL AUTO_INCREMENT,
  booking_id INT NOT NULL,
  action VARCHAR(20) NOT NULL,
  from_course_event_id INT NULL DEFAULT NULL,
  to_course_event_id INT NULL DEFAULT NULL,
  notes VARCHAR(255) NOT NULL DEFAULT '',
  updated_by_admin_id INT NOT NULL DEFAULT 0,
  created DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY booking_id (booking_id),
  KEY action (action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;

-- PHP reminder crons still run in production. After this migration they
-- must skip held bookings, e.g.:
--   AND IFNULL(bookings.on_hold, 0) = 0
-- in automatic_reminder_cron.php, automated_email_cron.php and
-- itinary_feedback_email_cron.php.
