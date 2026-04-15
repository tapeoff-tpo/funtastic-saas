CREATE TYPE "public"."adjustment_reason" AS ENUM('incoming', 'defective', 'physical_count', 'return', 'order_ship', 'order_cancel', 'other');--> statement-breakpoint
CREATE TYPE "public"."auth_type" AS ENUM('hmac', 'oauth2', 'api_key', 'session');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('requested', 'processing', 'completed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."claim_type" AS ENUM('cancel', 'return', 'exchange');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('connected', 'error', 'expired', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('new', 'confirmed', 'preparing', 'shipped', 'delivering', 'delivered', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('draft', 'active', 'inactive', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."shipment_group_status" AS ENUM('suggested', 'confirmed', 'rejected', 'shipped');--> statement-breakpoint
CREATE TYPE "public"."upload_status" AS ENUM('pending', 'uploading', 'uploaded', 'failed', 'confirmed');--> statement-breakpoint
CREATE TABLE "carrier_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"carrier_id" varchar(50) NOT NULL,
	"name" varchar(200) NOT NULL,
	"columns" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"internal_category" varchar(200) NOT NULL,
	"marketplace_id" varchar(50) NOT NULL,
	"marketplace_category_id" varchar(200) NOT NULL,
	"marketplace_category_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"marketplace_id" varchar(50) NOT NULL,
	"marketplace_claim_id" varchar(200) NOT NULL,
	"claim_type" "claim_type" NOT NULL,
	"claim_status" "claim_status" DEFAULT 'requested' NOT NULL,
	"reason" text,
	"raw_data" jsonb,
	"requested_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"company_name" varchar(200) DEFAULT '' NOT NULL,
	"phone" varchar(50) DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"zip_code" varchar(10) DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"sku" varchar(100) NOT NULL,
	"product_name" text NOT NULL,
	"warehouse_zone" varchar(100),
	"sector_code" varchar(100),
	"total_stock" integer DEFAULT 0 NOT NULL,
	"reserved_stock" integer DEFAULT 0 NOT NULL,
	"available_stock" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"adjustment_reason" "adjustment_reason" NOT NULL,
	"delta" integer NOT NULL,
	"previous_total" integer NOT NULL,
	"new_total" integer NOT NULL,
	"note" text,
	"order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_type" varchar(50) NOT NULL,
	"marketplace_id" varchar(50),
	"connection_id" uuid,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"orders_collected" integer,
	"claims_collected" integer,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"marketplace_id" varchar(50) NOT NULL,
	"store_alias" varchar(100) DEFAULT 'default' NOT NULL,
	"display_name" text NOT NULL,
	"auth_type" "auth_type" NOT NULL,
	"status" "connection_status" DEFAULT 'disconnected' NOT NULL,
	"vault_secret_names" jsonb NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error_message" text,
	"expires_at" timestamp with time zone,
	"metadata" jsonb,
	"is_manual" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"marketplace_item_id" varchar(200),
	"product_name" text NOT NULL,
	"option_text" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"sku" varchar(100),
	"fulfillment_code" varchar(50) DEFAULT 'normal'
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"connection_id" uuid,
	"marketplace_id" varchar(50) NOT NULL,
	"marketplace_order_id" varchar(200) NOT NULL,
	"status" "order_status" DEFAULT 'new' NOT NULL,
	"previous_status" "order_status",
	"buyer_name" varchar(200) NOT NULL,
	"buyer_phone" varchar(50),
	"recipient_name" varchar(200) NOT NULL,
	"recipient_phone" varchar(50),
	"shipping_address" jsonb,
	"ordered_at" timestamp with time zone NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"is_held" boolean DEFAULT false NOT NULL,
	"hold_reason" text,
	"held_at" timestamp with time zone,
	"raw_data" jsonb,
	"marketplace_status" varchar(100),
	"collected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_change_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"field_name" varchar(100) NOT NULL,
	"old_value" text,
	"new_value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_marketplace_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"marketplace_id" varchar(50) NOT NULL,
	"marketplace_product_id" varchar(200) NOT NULL,
	"marketplace_category_id" varchar(200),
	"sync_status" varchar(50) DEFAULT 'synced' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_sync_error" text,
	"raw_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_name_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"marketplace_id" varchar(50) NOT NULL,
	"marketplace_name" text NOT NULL,
	"display_name" text NOT NULL,
	"picking_location" varchar(100),
	"product_id" uuid,
	"variant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" varchar(100) NOT NULL,
	"option_name" varchar(200),
	"option_values" jsonb,
	"price_adjustment" numeric(12, 2) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"internal_sku" varchar(100) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"base_price" numeric(12, 2) NOT NULL,
	"cost_price" numeric(12, 2),
	"category_id" varchar(100),
	"status" "product_status" DEFAULT 'draft' NOT NULL,
	"images" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_group_orders" (
	"shipment_group_id" uuid NOT NULL,
	"order_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"group_key" varchar(200) NOT NULL,
	"status" "shipment_group_status" DEFAULT 'suggested' NOT NULL,
	"fulfillment_code" varchar(50) DEFAULT 'normal' NOT NULL,
	"max_pack_quantity" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tracking_number" varchar(100) NOT NULL,
	"carrier_id" varchar(50) NOT NULL,
	"carrier_name" varchar(100) NOT NULL,
	"upload_status" "upload_status" DEFAULT 'pending' NOT NULL,
	"marketplace_upload_error" text,
	"upload_attempts" integer DEFAULT 0 NOT NULL,
	"last_upload_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_history" ADD CONSTRAINT "inventory_history_inventory_id_inventory_id_fk" FOREIGN KEY ("inventory_id") REFERENCES "public"."inventory"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_history" ADD CONSTRAINT "inventory_history_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_connection_id_marketplace_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."marketplace_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_change_logs" ADD CONSTRAINT "product_change_logs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_marketplace_links" ADD CONSTRAINT "product_marketplace_links_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_marketplace_links" ADD CONSTRAINT "product_marketplace_links_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_name_mappings" ADD CONSTRAINT "product_name_mappings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_name_mappings" ADD CONSTRAINT "product_name_mappings_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_group_orders" ADD CONSTRAINT "shipment_group_orders_shipment_group_id_shipment_groups_id_fk" FOREIGN KEY ("shipment_group_id") REFERENCES "public"."shipment_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_group_orders" ADD CONSTRAINT "shipment_group_orders_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "category_mappings_unique" ON "category_mappings" USING btree ("user_id","internal_category","marketplace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claims_marketplace_unique" ON "claims" USING btree ("marketplace_id","marketplace_claim_id");--> statement-breakpoint
CREATE INDEX "claims_order_id" ON "claims" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_settings_user_id" ON "company_settings" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_user_sku" ON "inventory" USING btree ("user_id","sku");--> statement-breakpoint
CREATE INDEX "inventory_user_id" ON "inventory" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "inventory_history_inventory_id" ON "inventory_history" USING btree ("inventory_id");--> statement-breakpoint
CREATE INDEX "inventory_history_order_id" ON "inventory_history" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_connections_user_market_alias" ON "marketplace_connections" USING btree ("user_id","marketplace_id","store_alias");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_marketplace_unique" ON "orders" USING btree ("marketplace_id","marketplace_order_id");--> statement-breakpoint
CREATE INDEX "orders_user_status" ON "orders" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "orders_ordered_at" ON "orders" USING btree ("ordered_at");--> statement-breakpoint
CREATE INDEX "product_change_logs_product_id" ON "product_change_logs" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_change_logs_created_at" ON "product_change_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_marketplace_links_unique" ON "product_marketplace_links" USING btree ("marketplace_id","marketplace_product_id");--> statement-breakpoint
CREATE INDEX "product_marketplace_links_product" ON "product_marketplace_links" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_name_mappings_unique" ON "product_name_mappings" USING btree ("user_id","marketplace_id","marketplace_name");--> statement-breakpoint
CREATE INDEX "product_name_mappings_user" ON "product_name_mappings" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_product_sku" ON "product_variants" USING btree ("product_id","sku");--> statement-breakpoint
CREATE UNIQUE INDEX "products_user_sku" ON "products" USING btree ("user_id","internal_sku");--> statement-breakpoint
CREATE INDEX "products_user_status" ON "products" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_group_orders_pk" ON "shipment_group_orders" USING btree ("shipment_group_id","order_id");--> statement-breakpoint
CREATE INDEX "shipments_order_id" ON "shipments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "shipments_upload_status" ON "shipments" USING btree ("upload_status");