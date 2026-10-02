-- Magic-link signup: an account now starts "pending" (no password, no session)
-- until its owner clicks the emailed link and chooses a password.
-- Existing accounts default to 0, so nobody who already has an account is
-- affected. Only accounts created by the new signup flow are ever 1.
ALTER TABLE users ADD COLUMN email_confirmation_pending INTEGER NOT NULL DEFAULT 0;
-- When the emailed link stops working. verify_token now holds a SHA-256 hash of
-- the link's token rather than the token itself; older raw tokens have no expiry.
ALTER TABLE users ADD COLUMN verify_token_expires TEXT;
