-- Publish/draft for CMS pages (1 = live on site, 0 = preview only).
-- Safe to re-run: skip if column already exists (MySQL 8.0.29+ / MariaDB).

ALTER TABLE pages
  ADD COLUMN IF NOT EXISTS status TINYINT(1) NOT NULL DEFAULT 1
  COMMENT '1=published on site, 0=draft (preview only)';
