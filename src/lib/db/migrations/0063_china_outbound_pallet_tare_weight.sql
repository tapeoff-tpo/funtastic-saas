-- Add only pallet packaging tare. Existing measured gross values stay intact.
ALTER TABLE china_outbound_pallets
  ADD COLUMN IF NOT EXISTS tare_weight_kg numeric(12, 3) DEFAULT 5;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'china_outbound_pallets_tare_nonnegative'
      AND conrelid = 'china_outbound_pallets'::regclass
  ) THEN
    ALTER TABLE china_outbound_pallets ADD CONSTRAINT china_outbound_pallets_tare_nonnegative
      CHECK (tare_weight_kg IS NULL OR tare_weight_kg >= 0);
  END IF;
END $$;
