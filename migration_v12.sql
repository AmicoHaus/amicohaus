-- Adds first-time/primary buyer profiles: a listing with no home to trade,
-- only a "what I'm looking for" side, so buyers don't have to fake owning a
-- property just to participate.
ALTER TABLE listings ADD COLUMN is_buyer_only INTEGER NOT NULL DEFAULT 0;
