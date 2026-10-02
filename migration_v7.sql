-- Amico Haus — migration v7 (IP-based rate limiting for the contact form)
-- Run this ONCE in the D1 console, after migration_v6.sql is already applied.

ALTER TABLE leads ADD COLUMN ip TEXT;
