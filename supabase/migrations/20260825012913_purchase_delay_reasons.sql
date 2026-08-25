ALTER TABLE public.purchase_request_items
  ADD COLUMN IF NOT EXISTS delay_reason varchar(50),
  ADD COLUMN IF NOT EXISTS delay_note text,
  ADD COLUMN IF NOT EXISTS delay_recorded_at timestamptz;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS purchasing_status varchar(50) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS purchasing_status_note text,
  ADD COLUMN IF NOT EXISTS purchasing_status_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS products_user_purchasing_status
  ON public.products (user_id, purchasing_status);

CREATE INDEX IF NOT EXISTS purchase_request_items_user_delay_reason
  ON public.purchase_request_items (user_id, delay_reason)
  WHERE delay_reason IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'purchase_request_items_delay_reason_check'
  ) THEN
    ALTER TABLE public.purchase_request_items
      ADD CONSTRAINT purchase_request_items_delay_reason_check
      CHECK (delay_reason IS NULL OR delay_reason IN (
        'discontinued',
        'supplier_changed',
        'temporary_out_of_stock',
        'production_or_shipping_delay',
        'quality_or_spec_issue',
        'under_review',
        'other',
        'resolved'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_purchasing_status_check'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_purchasing_status_check
      CHECK (purchasing_status IN (
        'active',
        'discontinued',
        'supplier_changed',
        'temporarily_unavailable',
        'delayed',
        'under_review'
      ));
  END IF;
END $$;
