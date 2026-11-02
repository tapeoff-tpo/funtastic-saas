-- Preserve item classification in historical shipments even after stock refreshes.
ALTER TABLE public.china_outbound_shipment_items
  ADD COLUMN IF NOT EXISTS item_category varchar(100);
