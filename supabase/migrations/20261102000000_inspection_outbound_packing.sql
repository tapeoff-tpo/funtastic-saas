ALTER TABLE public.saas_china_shipment_purchase_allocations
  ADD COLUMN IF NOT EXISTS inspection_boxes jsonb NOT NULL DEFAULT '[]'::jsonb;
