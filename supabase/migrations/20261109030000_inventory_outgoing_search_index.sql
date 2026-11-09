CREATE INDEX CONCURRENTLY IF NOT EXISTS outbound_reflection_applied_user_sku_date_idx
  ON public.outbound_reflection_lines (user_id, sku, shipment_date)
  WHERE reflection_status = 'applied';
