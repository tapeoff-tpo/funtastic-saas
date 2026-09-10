-- A purchase can legitimately progress through multiple lifecycle rows with the
-- same management code and SKU (for example, China arrival and China outbound).
-- Keep the lookup path, but do not enforce uniqueness across those rows.
DROP INDEX IF EXISTS "purchase_request_items_user_management_code_sku";

CREATE INDEX IF NOT EXISTS "purchase_request_items_user_management_code_sku"
  ON "purchase_request_items" ("user_id", "purchase_management_code", "sku");
