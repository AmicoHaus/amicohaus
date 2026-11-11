-- Home facts/reach batch (migration_v46): owner-entered home facts (yard and sun, parking and garage, pets),
-- floor-plan twins, toy-box saved searches, open-house address sharing with RSVPs, and a private display language.
-- Applies on v45. Only ADD COLUMN and CREATE INDEX IF NOT EXISTS; no backfill.

-- Home facts (functions/_lib/homeFacts.js): what the owner says about the yard, sun, parking, garage and pets.
-- '{}' = nothing entered; a missing key means the owner didn't say (never "no"). Keys are checked in code.
ALTER TABLE listings ADD COLUMN home_facts_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE pre_listings ADD COLUMN home_facts_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE augmented_homes ADD COLUMN home_facts_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE green_homes ADD COLUMN home_facts_json TEXT NOT NULL DEFAULT '{}';

-- Floor-plan twins (functions/_lib/planTwins.js): the builder, plan and community the owner typed. plan_key is the
-- normalized builder|community|plan; homes are listed together only when plan_twins = 1 (the owner opted in).
ALTER TABLE listings ADD COLUMN plan_builder TEXT;
ALTER TABLE listings ADD COLUMN plan_name TEXT;
ALTER TABLE listings ADD COLUMN plan_community TEXT;
ALTER TABLE listings ADD COLUMN plan_key TEXT;
ALTER TABLE listings ADD COLUMN plan_twins INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_listings_plan_key ON listings(plan_key);

-- Toy-box saved searches: bit flags (1 RV/boat parking, 2 side access, 4 workshop, 8 240V/EV outlet) and minimums.
-- 0 / NULL = not asked for. (HOA parking is a browse filter only.)
ALTER TABLE saved_searches ADD COLUMN toy_flags INTEGER NOT NULL DEFAULT 0;
ALTER TABLE saved_searches ADD COLUMN min_gate_in INTEGER;
ALTER TABLE saved_searches ADD COLUMN min_garage INTEGER;

-- Open-house route: the owner chose to share the street address with people who RSVP (from 24 hours before the
-- start until the end). 0 = not shared (the default).
ALTER TABLE open_houses ADD COLUMN share_address_with_rsvps INTEGER NOT NULL DEFAULT 0;
ALTER TABLE augmented_home_open_houses ADD COLUMN share_address_with_rsvps INTEGER NOT NULL DEFAULT 0;
ALTER TABLE green_home_open_houses ADD COLUMN share_address_with_rsvps INTEGER NOT NULL DEFAULT 0;
-- rsvp_named: 1 = the person RSVP'd after being told the owner sees their display name (every RSVP the new code
-- makes); 0 = an RSVP from before (only counted, never named, no address until they RSVP again).
ALTER TABLE open_house_rsvps ADD COLUMN rsvp_named INTEGER NOT NULL DEFAULT 0;
ALTER TABLE augmented_home_open_house_rsvps ADD COLUMN rsvp_named INTEGER NOT NULL DEFAULT 0;
ALTER TABLE green_home_open_house_rsvps ADD COLUMN rsvp_named INTEGER NOT NULL DEFAULT 0;
-- "My open-house plan" reads RSVPs by person.
CREATE INDEX IF NOT EXISTS idx_open_house_rsvps_user ON open_house_rsvps(user_id);
CREATE INDEX IF NOT EXISTS idx_augmented_home_open_house_rsvps_user ON augmented_home_open_house_rsvps(user_id);
CREATE INDEX IF NOT EXISTS idx_green_home_open_house_rsvps_user ON green_home_open_house_rsvps(user_id);

-- Spanish pages: the person's own display language. Private to them: never shown to others and never used for
-- matching, alerts, filters, lists or counts (fair housing).
ALTER TABLE users ADD COLUMN ui_lang TEXT NOT NULL DEFAULT 'en' CHECK(ui_lang IN ('en','es'));
