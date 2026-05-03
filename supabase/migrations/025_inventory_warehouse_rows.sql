-- Allow one inventory row per SKU and warehouse.
-- Existing SKU-only uniqueness collapsed usable/defective stock across warehouses.

DROP INDEX IF EXISTS inventory_user_sku;
ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_user_sku;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_user_sku_warehouse
  ON inventory (user_id, sku, warehouse_zone, sector_code);

CREATE INDEX IF NOT EXISTS inventory_user_sku_idx
  ON inventory (user_id, sku);
