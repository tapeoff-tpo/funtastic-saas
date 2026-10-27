-- User-managed warehouse labels for the isolated SaaS China outbound flow.
-- This intentionally does not touch the replaceable Ecount/raw-data China
-- inventory tables.
CREATE TABLE IF NOT EXISTS public.saas_china_outbound_warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  warehouse_code varchar(100) NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saas_china_outbound_warehouses_user_code_key
    UNIQUE (user_id, warehouse_code)
);

CREATE UNIQUE INDEX IF NOT EXISTS saas_china_outbound_warehouses_user_default
  ON public.saas_china_outbound_warehouses(user_id)
  WHERE is_default;
CREATE INDEX IF NOT EXISTS saas_china_outbound_warehouses_user_updated
  ON public.saas_china_outbound_warehouses(user_id, updated_at);

-- Snapshot the chosen warehouse on each reservation. Current inventory rows
-- can then be renamed without rewriting historical outbound documents.
ALTER TABLE public.china_outbound_shipment_items
  ADD COLUMN IF NOT EXISTS origin_warehouse_code varchar(100);

UPDATE public.china_outbound_shipment_items AS shipment_item
SET origin_warehouse_code = inventory.warehouse_code
FROM public.saas_china_inventory AS inventory
WHERE shipment_item.origin_warehouse_code IS NULL
  AND inventory.id = shipment_item.inventory_id
  AND inventory.user_id = shipment_item.user_id;

UPDATE public.china_outbound_shipment_items AS shipment_item
SET origin_warehouse_code = shipment.origin_warehouse_code
FROM public.china_outbound_shipments AS shipment
WHERE shipment_item.origin_warehouse_code IS NULL
  AND shipment.id = shipment_item.shipment_id
  AND shipment.user_id = shipment_item.user_id;

UPDATE public.china_outbound_shipment_items
SET origin_warehouse_code = 'default'
WHERE origin_warehouse_code IS NULL;

ALTER TABLE public.china_outbound_shipment_items
  ALTER COLUMN origin_warehouse_code SET DEFAULT 'default';
ALTER TABLE public.china_outbound_shipment_items
  ALTER COLUMN origin_warehouse_code SET NOT NULL;

ALTER TABLE public.saas_china_outbound_warehouses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.saas_china_outbound_warehouses FROM anon, authenticated;
