CREATE INDEX IF NOT EXISTS "shipments_user_tracking_number_idx"
ON "shipments" USING btree ("user_id", "tracking_number");
