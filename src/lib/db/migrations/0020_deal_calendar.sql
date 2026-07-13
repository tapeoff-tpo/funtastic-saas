CREATE TABLE IF NOT EXISTS "deal_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL, "deal_type" varchar(30) NOT NULL, "title" text NOT NULL,
  "product_id" varchar(100), "product_code" varchar(100), "options" text,
  "regular_price" integer, "deal_price" integer NOT NULL, "unit_cost" integer,
  "shipping_cost" integer DEFAULT 0 NOT NULL, "stock" integer DEFAULT 500 NOT NULL,
  "daily_capacity" integer DEFAULT 500 NOT NULL, "starts_on" date NOT NULL, "ends_on" date NOT NULL,
  "status" varchar(30) DEFAULT 'draft' NOT NULL, "contact" varchar(50), "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL, "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "deal_events_user_date_idx" ON "deal_events" ("user_id", "starts_on");
CREATE INDEX IF NOT EXISTS "deal_events_user_status_idx" ON "deal_events" ("user_id", "status");
