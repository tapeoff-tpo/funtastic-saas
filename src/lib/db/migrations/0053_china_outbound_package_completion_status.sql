-- Preserve existing shipments: NULL keeps the legacy content-derived status.
ALTER TABLE china_outbound_boxes ADD COLUMN IF NOT EXISTS completion_status varchar(20);
ALTER TABLE china_outbound_pallets ADD COLUMN IF NOT EXISTS completion_status varchar(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'china_outbound_boxes_completion_status'
      AND conrelid = 'china_outbound_boxes'::regclass
  ) THEN
    ALTER TABLE china_outbound_boxes ADD CONSTRAINT china_outbound_boxes_completion_status
      CHECK (completion_status IS NULL OR completion_status IN ('in_progress', 'completed'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'china_outbound_pallets_completion_status'
      AND conrelid = 'china_outbound_pallets'::regclass
  ) THEN
    ALTER TABLE china_outbound_pallets ADD CONSTRAINT china_outbound_pallets_completion_status
      CHECK (completion_status IS NULL OR completion_status IN ('in_progress', 'completed'));
  END IF;
END $$;
