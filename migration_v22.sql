-- Agent self-reported availability/coverage signals, and the reciprocal
-- seller stipulation for a hyper-local specialist. Nothing here is
-- independently verified, same footing as every other self-reported field.
ALTER TABLE agent_profiles ADD COLUMN accepting_clients INTEGER NOT NULL DEFAULT 1;
ALTER TABLE agent_profiles ADD COLUMN carries_eo_insurance INTEGER NOT NULL DEFAULT 0;

ALTER TABLE pre_listings ADD COLUMN prefers_local_specialist INTEGER NOT NULL DEFAULT 0;
