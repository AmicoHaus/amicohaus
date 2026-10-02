-- Adds portfolio trades: a user bundles 2+ of their own existing listings
-- into one tradeable unit with its own "what would make you move" criteria,
-- so they can trade a portfolio of properties for one larger home, or for
-- another portfolio. The portfolio itself is just another row in `listings`
-- (is_portfolio = 1) with aggregated current-value fields and its own
-- desired_criteria row — it needs no changes to the matching engine at all,
-- since a portfolio is scored/matched exactly like any other listing.
-- Bundled member listings are excluded from independent matching/directory
-- display everywhere via "NOT IN (SELECT member_listing_id FROM
-- portfolio_members)" rather than a denormalized flag, so there's no risk of
-- that flag drifting out of sync with the membership table.
ALTER TABLE listings ADD COLUMN is_portfolio INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS portfolio_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  member_listing_id INTEGER NOT NULL UNIQUE REFERENCES listings(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_portfolio_members_portfolio ON portfolio_members(portfolio_listing_id);
