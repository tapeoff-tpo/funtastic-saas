CREATE INDEX IF NOT EXISTS "shipments_shipped_at_order_id_idx"
ON "shipments" USING btree ("shipped_at", "order_id")
WHERE "shipped_at" IS NOT NULL;
