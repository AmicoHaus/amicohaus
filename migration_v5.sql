-- Amico Haus — migration v5 (robust profiles)
-- Run this ONCE in the D1 console, after migration_v4.sql is already applied.

ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT '';
