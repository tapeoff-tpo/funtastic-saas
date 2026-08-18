ALTER TABLE outbound_reflection_batches
  ADD COLUMN IF NOT EXISTS apply_inventory boolean NOT NULL DEFAULT true;
