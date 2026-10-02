-- Amico Haus — migration v9 (match notifications, listing view counts, referrals)
-- Run this ONCE in the D1 console, after migration_v8.sql is already applied.

ALTER TABLE listings ADD COLUMN views INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN referral_code TEXT;
ALTER TABLE users ADD COLUMN referred_by INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
