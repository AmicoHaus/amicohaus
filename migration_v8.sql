-- Amico Haus — migration v8 (broker/agent listings on behalf of a client)
-- Run this ONCE in the D1 console, after migration_v7.sql is already applied.

ALTER TABLE listings ADD COLUMN client_name TEXT;
