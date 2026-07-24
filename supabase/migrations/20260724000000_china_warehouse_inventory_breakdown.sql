ALTER TABLE public.china_warehouse_inventory
  ADD COLUMN IF NOT EXISTS warehouse_quantities jsonb NOT NULL DEFAULT '{}'::jsonb;
