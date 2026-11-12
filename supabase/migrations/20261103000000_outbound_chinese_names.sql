ALTER TABLE public.china_outbound_shipment_items
  ADD COLUMN IF NOT EXISTS chinese_product_name text;
