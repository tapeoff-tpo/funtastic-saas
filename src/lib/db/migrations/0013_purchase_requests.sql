CREATE TYPE "purchase_request_status" AS ENUM (
  'requested',
  'planned',
  'purchasing',
  'china_arrived',
  'cancelled'
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_request_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "source_file_name" varchar(255) NOT NULL,
  "source_sheet_name" varchar(100) DEFAULT '발주등록' NOT NULL,
  "total_rows" integer DEFAULT 0 NOT NULL,
  "imported_rows" integer DEFAULT 0 NOT NULL,
  "skipped_rows" integer DEFAULT 0 NOT NULL,
  "uploaded_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_request_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "batch_id" uuid,
  "row_number" integer NOT NULL,
  "status" "purchase_request_status" DEFAULT 'requested' NOT NULL,
  "request_date" date,
  "sequence" integer,
  "manager_code" varchar(50),
  "inbound_warehouse_code" varchar(50),
  "trade_type" varchar(50),
  "currency" varchar(20),
  "exchange_rate" numeric(12, 4),
  "due_date" date,
  "requester" varchar(100),
  "extra_budget_yn" varchar(10),
  "memo" text,
  "sku" varchar(100) NOT NULL,
  "product_name" text NOT NULL,
  "option_name" varchar(200),
  "requested_quantity" integer DEFAULT 0 NOT NULL,
  "china_arrival_request_date" date,
  "package_set_quantity" integer,
  "actual_purchase_quantity" integer,
  "purchase_management_code" varchar(100),
  "purchase_memo" text,
  "prepack_required" varchar(20),
  "barcode_name" text,
  "barcode_no" varchar(100),
  "stock_memo" text,
  "unit_price_cny" numeric(12, 2),
  "total_price_cny" numeric(14, 2),
  "total_price_krw" numeric(14, 2),
  "shipping_fee_cny" numeric(12, 2),
  "production_process" text,
  "purchase_note" text,
  "package_required_code" varchar(50),
  "package_required" varchar(50),
  "korean_manual_required_code" varchar(50),
  "korean_manual_required" varchar(50),
  "source_current_state" varchar(100),
  "improvement_feedback_date" date,
  "expected_arrival_date" date,
  "product_type" varchar(100),
  "buyer_name" varchar(100),
  "buyer_code" varchar(50),
  "supplier_order_number" varchar(100),
  "outbound_expected_date" date,
  "purchase_method" varchar(100),
  "purchase_confirmed" boolean DEFAULT false NOT NULL,
  "china_received_quantity" integer,
  "china_received_at" timestamp with time zone,
  "recommendation_basis" varchar(50),
  "sales_average_window_days" integer,
  "manual_average_sales" numeric(12, 2),
  "is_seasonal" boolean DEFAULT false NOT NULL,
  "is_new_product" boolean DEFAULT false NOT NULL,
  "is_sales_surging" boolean DEFAULT false NOT NULL,
  "raw_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_request_items"
ADD CONSTRAINT "purchase_request_items_batch_id_purchase_request_batches_id_fk"
FOREIGN KEY ("batch_id") REFERENCES "purchase_request_batches"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_request_batches_user_created"
ON "purchase_request_batches" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_request_items_user_status"
ON "purchase_request_items" USING btree ("user_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_request_items_user_sku"
ON "purchase_request_items" USING btree ("user_id", "sku");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_request_items_batch"
ON "purchase_request_items" USING btree ("batch_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_request_items_user_management_code"
ON "purchase_request_items" USING btree ("user_id", "purchase_management_code");
