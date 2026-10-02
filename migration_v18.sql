-- Agent service areas (up to 4 zip codes + a fixed 20-mile radius), agent
-- marketing/track-record fields, and seller-side pre-listing stipulations
-- (occupancy, showing notice, special instructions, and the pre-listing's
-- own zip so it can be checked against an agent's service area).
--
-- zip_codes is static reference data (US ZCTA centroids, ~33.8k rows) used
-- by functions/_lib/geo.js's haversine distance check — it's applied
-- separately from this file via zip_codes_data.sql (a plain data file, not
-- really a "migration" — nothing here depends on it existing yet, so it can
-- be applied before or after this one).
CREATE TABLE IF NOT EXISTS zip_codes (
  zip TEXT PRIMARY KEY,
  lat REAL NOT NULL,
  lng REAL NOT NULL
);

ALTER TABLE agent_profiles ADD COLUMN service_zips_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE agent_profiles ADD COLUMN open_house_days_json TEXT NOT NULL DEFAULT '[]';
-- Self-reported, same as license_number — not verified against any MLS.
ALTER TABLE agent_profiles ADD COLUMN avg_days_on_market INTEGER;
ALTER TABLE agent_profiles ADD COLUMN homes_sold_last_year INTEGER;

ALTER TABLE pre_listings ADD COLUMN zip TEXT NOT NULL DEFAULT '';
ALTER TABLE pre_listings ADD COLUMN occupancy_status TEXT NOT NULL DEFAULT 'occupied' CHECK(occupancy_status IN ('occupied','vacant'));
ALTER TABLE pre_listings ADD COLUMN showing_notice_hours INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pre_listings ADD COLUMN special_instructions TEXT NOT NULL DEFAULT '';
