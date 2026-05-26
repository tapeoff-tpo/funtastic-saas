ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS marketplace_collection_status VARCHAR(50);

CREATE INDEX IF NOT EXISTS orders_user_marketplace_collection_status_idx
  ON orders(user_id, marketplace_collection_status);
