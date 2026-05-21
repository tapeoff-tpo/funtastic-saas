CREATE TABLE IF NOT EXISTS inventory_adjustment_slips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id uuid NOT NULL REFERENCES inventory(id),
  user_id uuid NOT NULL,
  sku varchar(100) NOT NULL,
  product_name text NOT NULL,
  option_name varchar(200),
  warehouse_zone varchar(100),
  sector_code varchar(100),
  adjustment_reason adjustment_reason NOT NULL,
  delta integer NOT NULL,
  note text,
  status varchar(20) NOT NULL DEFAULT 'pending',
  registered_by uuid,
  registered_by_name text,
  confirmed_by uuid,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_adjustment_slips_user_created
  ON inventory_adjustment_slips(user_id, created_at);

CREATE INDEX IF NOT EXISTS inventory_adjustment_slips_status
  ON inventory_adjustment_slips(status);

CREATE INDEX IF NOT EXISTS inventory_adjustment_slips_inventory_id
  ON inventory_adjustment_slips(inventory_id);

INSERT INTO inventory_adjustment_slips (
  inventory_id,
  user_id,
  sku,
  product_name,
  option_name,
  warehouse_zone,
  sector_code,
  adjustment_reason,
  delta,
  note,
  status,
  confirmed_at,
  created_at,
  updated_at
)
SELECT
  h.inventory_id,
  h.user_id,
  i.sku,
  i.product_name,
  i.option_name,
  i.warehouse_zone,
  i.sector_code,
  h.adjustment_reason,
  h.delta,
  h.note,
  'confirmed',
  h.created_at,
  h.created_at,
  h.created_at
FROM inventory_history h
JOIN inventory i ON i.id = h.inventory_id
WHERE NOT EXISTS (
  SELECT 1
  FROM inventory_adjustment_slips s
  WHERE s.inventory_id = h.inventory_id
    AND s.delta = h.delta
    AND s.created_at = h.created_at
    AND s.status = 'confirmed'
);
