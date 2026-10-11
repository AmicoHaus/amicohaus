-- Marks an open house as already having had its RSVP reminder email sent, so a scheduled job (content/
-- dispatcher built in functions/_lib/openHouseReminders.js, but NOT yet wired to a live Cron Trigger --
-- that's a separate decision, same reasoning as weeklyDigest.js) never double-sends to the same RSVPs.
-- One generic table across all 3 open-house kinds rather than a column on each of the 3 tables.
CREATE TABLE IF NOT EXISTS open_house_reminders_sent (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_kind TEXT NOT NULL CHECK(entity_kind IN ('listing','augmented_home','green_home')),
  open_house_id INTEGER NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(entity_kind, open_house_id)
);
