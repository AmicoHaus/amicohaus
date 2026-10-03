-- A homeowner's own checklist of California's common pre-listing seller disclosures — informational only, not
-- legal advice (same footing as every other preference field on a pre-listing). Stored as the JSON array of
-- item keys the owner has checked off; the fixed item list itself lives in code (functions/_lib/disclosures.js),
-- not the database, so adding/renaming an item never needs a migration.
ALTER TABLE pre_listings ADD COLUMN disclosure_checklist_json TEXT NOT NULL DEFAULT '[]';
