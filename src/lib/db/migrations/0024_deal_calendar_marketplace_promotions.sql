ALTER TABLE "deal_events" ADD COLUMN IF NOT EXISTS "platform" varchar(30) DEFAULT 'kakao' NOT NULL;
ALTER TABLE "deal_events" ADD COLUMN IF NOT EXISTS "application_starts_on" date;
ALTER TABLE "deal_events" ADD COLUMN IF NOT EXISTS "application_ends_on" date;
ALTER TABLE "deal_events" ADD COLUMN IF NOT EXISTS "minimum_discount_rate" integer;
ALTER TABLE "deal_events" ADD COLUMN IF NOT EXISTS "applied_product_count" integer;
ALTER TABLE "deal_events" ADD COLUMN IF NOT EXISTS "discount_code" varchar(50);
ALTER TABLE "deal_events" ADD COLUMN IF NOT EXISTS "external_promotion_id" varchar(50);
ALTER TABLE "deal_events" ADD COLUMN IF NOT EXISTS "source_key" varchar(100);
CREATE UNIQUE INDEX IF NOT EXISTS "deal_events_user_source_key_uniq" ON "deal_events" ("user_id", "source_key") WHERE "source_key" IS NOT NULL;
