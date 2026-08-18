-- Default pricing templates for course events (admin courses add/edit)
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS default_price_type VARCHAR(10) NULL DEFAULT NULL AFTER default_end_time,
  ADD COLUMN IF NOT EXISTS default_school_one_off_price DOUBLE NOT NULL DEFAULT 0 AFTER default_price_type,
  ADD COLUMN IF NOT EXISTS default_school_deposit_price DOUBLE NOT NULL DEFAULT 0 AFTER default_school_one_off_price,
  ADD COLUMN IF NOT EXISTS default_school_total_price DOUBLE NOT NULL DEFAULT 0 AFTER default_school_deposit_price,
  ADD COLUMN IF NOT EXISTS default_own_one_off_price DOUBLE NOT NULL DEFAULT 0 AFTER default_school_total_price,
  ADD COLUMN IF NOT EXISTS default_own_deposit_price DOUBLE NOT NULL DEFAULT 0 AFTER default_own_one_off_price,
  ADD COLUMN IF NOT EXISTS default_own_total_price DOUBLE NOT NULL DEFAULT 0 AFTER default_own_deposit_price;
