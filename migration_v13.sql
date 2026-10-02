-- Adds ultra-luxury rental listings: a landlord/property-manager posts a
-- property for lease instead of trade. No desired_criteria row is created for
-- these (they're not looking for a home back), so they never enter the
-- trade/buyer matching graph — only the separate rental-match calculation.
ALTER TABLE listings ADD COLUMN is_rental INTEGER NOT NULL DEFAULT 0;
ALTER TABLE listings ADD COLUMN rent_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE listings ADD COLUMN min_lease_months INTEGER NOT NULL DEFAULT 12;
