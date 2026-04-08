ALTER TABLE marketplace_connections ADD COLUMN IF NOT EXISTS is_manual BOOLEAN NOT NULL DEFAULT false;
