ALTER TABLE "deal_events"
ADD COLUMN IF NOT EXISTS "checklist" jsonb NOT NULL DEFAULT '[]'::jsonb;
