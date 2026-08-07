ALTER TABLE public.ecount_purchase_history_batches
  ADD COLUMN IF NOT EXISTS comparison_data jsonb NOT NULL DEFAULT '{}'::jsonb;
