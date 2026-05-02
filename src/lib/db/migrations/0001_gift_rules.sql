CREATE TABLE IF NOT EXISTS "gift_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "name" varchar(200) NOT NULL,
  "marketplace_id" varchar(50),
  "condition_type" varchar(20) NOT NULL,
  "min_amount" numeric(12, 2),
  "trigger_sku" varchar(100),
  "gift_sku" varchar(100) NOT NULL,
  "gift_quantity" integer DEFAULT 1 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "gift_rules_user_active" ON "gift_rules" ("user_id", "is_active");
CREATE INDEX IF NOT EXISTS "gift_rules_user_marketplace" ON "gift_rules" ("user_id", "marketplace_id");
