ALTER TABLE "deal_events"
ADD COLUMN IF NOT EXISTS "sold_quantity" integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "sales_amount" integer NOT NULL DEFAULT 0;
