CREATE TABLE IF NOT EXISTS actual_shipping_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  carrier_id varchar(50) NOT NULL,
  tracking_number varchar(100) NOT NULL,
  normalized_tracking_number varchar(100) NOT NULL,
  shipment_id uuid REFERENCES shipments(id) ON DELETE SET NULL,
  order_number varchar(200),
  accepted_at date,
  delivered_at date,
  actual_fee numeric(12, 2) NOT NULL,
  package_type varchar(100),
  quantity integer NOT NULL DEFAULT 1,
  payment_type varchar(100),
  shipment_type varchar(100),
  source_file_name varchar(255),
  row_number integer NOT NULL,
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS actual_shipping_costs_user_carrier_tracking_unique
  ON actual_shipping_costs(user_id, carrier_id, normalized_tracking_number);

CREATE INDEX IF NOT EXISTS actual_shipping_costs_user_imported_idx
  ON actual_shipping_costs(user_id, imported_at);

CREATE INDEX IF NOT EXISTS actual_shipping_costs_shipment_idx
  ON actual_shipping_costs(shipment_id);
