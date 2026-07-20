ALTER TABLE "deal_events"
  ADD COLUMN IF NOT EXISTS "campaign_name" varchar(100),
  ADD COLUMN IF NOT EXISTS "daily_budget" integer,
  ADD COLUMN IF NOT EXISTS "search_bid" integer,
  ADD COLUMN IF NOT EXISTS "recommendation_bid" integer;
