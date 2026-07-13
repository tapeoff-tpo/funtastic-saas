ALTER TABLE actual_shipping_costs
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS actual_shipping_costs_order_idx
  ON actual_shipping_costs(order_id);
