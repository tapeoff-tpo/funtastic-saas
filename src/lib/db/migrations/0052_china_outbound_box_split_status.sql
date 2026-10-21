-- The manual box-split status is nullable so existing saved shipments keep
-- their former quantity-derived display until an operator explicitly chooses
-- a status. New saves persist either in_progress or completed.
ALTER TABLE china_outbound_shipment_items
  ADD COLUMN IF NOT EXISTS box_split_status varchar(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'china_outbound_shipment_items_box_split_status'
  ) THEN
    ALTER TABLE china_outbound_shipment_items
      ADD CONSTRAINT china_outbound_shipment_items_box_split_status
      CHECK (box_split_status IS NULL OR box_split_status IN ('in_progress', 'completed'));
  END IF;
END $$;
