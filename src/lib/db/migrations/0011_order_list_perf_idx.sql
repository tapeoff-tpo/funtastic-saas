CREATE INDEX IF NOT EXISTS "orders_user_status_held_ordered_desc_idx"
ON "orders" USING btree ("user_id", "status", "is_held", "ordered_at" DESC, "created_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "orders_user_ordered_desc_idx"
ON "orders" USING btree ("user_id", "ordered_at" DESC, "created_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "orders_user_collected_desc_idx"
ON "orders" USING btree ("user_id", "collected_at" DESC, "created_at" DESC, "id" DESC)
WHERE "collected_at" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "orders_user_marketplace_order_id_idx"
ON "orders" USING btree ("user_id", "marketplace_id", "marketplace_order_id");

CREATE INDEX IF NOT EXISTS "claims_order_active_requested_idx"
ON "claims" USING btree ("order_id", "claim_type", "requested_at" DESC)
WHERE "claim_status" NOT IN ('rejected', 'withdrawn');

CREATE INDEX IF NOT EXISTS "shipments_order_created_desc_idx"
ON "shipments" USING btree ("order_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "scan_logs_order_scanned_desc_idx"
ON "scan_logs" USING btree ("order_id", "scanned_at" DESC);

CREATE INDEX IF NOT EXISTS "shipment_group_orders_order_id_idx"
ON "shipment_group_orders" USING btree ("order_id");
