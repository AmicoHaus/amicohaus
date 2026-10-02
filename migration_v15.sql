-- Email frequency control: 'every' sends a match email every time (the old,
-- only behavior), 'capped' skips the email (but still creates the in-app
-- bell notification) once someone's already gotten a few today. Defaults to
-- 'capped' for both new and existing accounts since unbounded per-match
-- emails only gets worse as listing volume grows — a real scheduled digest
-- would need a separate cron-triggered worker this project doesn't have, so
-- this is the achievable version of the same spam-reduction goal.
ALTER TABLE users ADD COLUMN email_frequency TEXT NOT NULL DEFAULT 'capped' CHECK(email_frequency IN ('every','capped'));
