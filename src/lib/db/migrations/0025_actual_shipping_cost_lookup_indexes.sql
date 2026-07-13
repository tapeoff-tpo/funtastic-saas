CREATE INDEX IF NOT EXISTS actual_shipping_costs_user_tracking_lookup_idx
  ON actual_shipping_costs(user_id, normalized_tracking_number);

CREATE INDEX IF NOT EXISTS actual_shipping_costs_user_order_number_idx
  ON actual_shipping_costs(user_id, order_number);
