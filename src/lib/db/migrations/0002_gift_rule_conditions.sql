ALTER TABLE "gift_rules"
  ADD COLUMN IF NOT EXISTS "conditions" jsonb DEFAULT '[]'::jsonb NOT NULL;
