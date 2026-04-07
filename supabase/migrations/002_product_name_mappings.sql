-- Migration: product_name_mappings
-- Maps marketplace product names to internal display names for shipping labels.
-- marketplace_name = exact text from order_items.product_name
-- display_name = what gets printed on 송장 / shipping docs

CREATE TABLE IF NOT EXISTS product_name_mappings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  marketplace_id  VARCHAR(50) NOT NULL,
  marketplace_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  product_id  UUID REFERENCES products(id) ON DELETE SET NULL,
  variant_id  UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT product_name_mappings_unique
    UNIQUE (user_id, marketplace_id, marketplace_name)
);

CREATE INDEX IF NOT EXISTS product_name_mappings_user
  ON product_name_mappings (user_id);

-- RLS: users see only their own mappings
ALTER TABLE product_name_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own mappings"
  ON product_name_mappings
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
