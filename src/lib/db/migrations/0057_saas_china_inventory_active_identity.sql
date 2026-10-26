-- Each Excel upload replaces the active SaaS China inventory snapshot. Older
-- inventory rows must stay available to immutable movement, outbound, and
-- purchase records, while the same identity can appear in the new snapshot.
DROP INDEX IF EXISTS saas_china_inventory_user_warehouse_sku_option;

CREATE UNIQUE INDEX IF NOT EXISTS saas_china_inventory_user_warehouse_sku_option_active
  ON saas_china_inventory(user_id, warehouse_code, sku, option_key)
  WHERE archived_at IS NULL;
