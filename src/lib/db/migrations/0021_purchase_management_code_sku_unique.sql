DROP INDEX IF EXISTS "purchase_request_items_user_management_code";
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_request_items_user_management_code_sku"
  ON "purchase_request_items" ("user_id", "purchase_management_code", "sku");
