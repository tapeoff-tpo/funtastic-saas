-- Keep the existing 12-digit integer capacity and retain fractional unit freight.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'new_product_workflow_items'
      AND column_name = 'unit_shipping_cny' AND numeric_scale < 6
  ) THEN
    ALTER TABLE new_product_workflow_items
      ALTER COLUMN unit_shipping_cny TYPE numeric(18, 6);
  END IF;
END $$;
