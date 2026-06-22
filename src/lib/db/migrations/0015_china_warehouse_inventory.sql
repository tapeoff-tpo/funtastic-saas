CREATE TABLE IF NOT EXISTS "china_warehouse_inventory" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "sku" varchar(100) NOT NULL,
  "product_name" text NOT NULL,
  "option_key" varchar(200) DEFAULT '' NOT NULL,
  "option_name" varchar(200),
  "total_quantity" integer DEFAULT 0 NOT NULL,
  "available_quantity" integer DEFAULT 0 NOT NULL,
  "last_arrived_at" timestamp with time zone,
  "last_outbound_requested_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "china_warehouse_inventory_movements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "inventory_id" uuid NOT NULL REFERENCES "china_warehouse_inventory"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL,
  "purchase_request_item_id" uuid NOT NULL REFERENCES "purchase_request_items"("id") ON DELETE CASCADE,
  "movement_type" varchar(50) NOT NULL,
  "delta" integer NOT NULL,
  "quantity_before" integer NOT NULL,
  "quantity_after" integer NOT NULL,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "china_warehouse_inventory_user_sku_option"
ON "china_warehouse_inventory" USING btree ("user_id", "sku", "option_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "china_warehouse_inventory_user_sku"
ON "china_warehouse_inventory" USING btree ("user_id", "sku");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "china_warehouse_movements_item_type"
ON "china_warehouse_inventory_movements" USING btree ("purchase_request_item_id", "movement_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "china_warehouse_movements_inventory_created"
ON "china_warehouse_inventory_movements" USING btree ("inventory_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "china_warehouse_movements_user_created"
ON "china_warehouse_inventory_movements" USING btree ("user_id", "created_at");
