ALTER TABLE "inventory"
  ADD COLUMN IF NOT EXISTS "defective_stock" integer DEFAULT 0 NOT NULL;
