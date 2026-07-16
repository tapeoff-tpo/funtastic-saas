-- Supports monthly analytics lookups without changing operational data.
CREATE INDEX IF NOT EXISTS shipments_user_shipped_at_order_idx
  ON shipments(user_id, shipped_at, order_id)
  WHERE shipped_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS actual_shipping_costs_user_order_unshipped_idx
  ON actual_shipping_costs(user_id, order_id)
  WHERE shipment_id IS NULL AND order_id IS NOT NULL;
