ALTER TABLE marketplace_registration_profiles
  ADD COLUMN IF NOT EXISTS source_type varchar(50) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_product_id text,
  ADD COLUMN IF NOT EXISTS product_name text,
  ADD COLUMN IF NOT EXISTS source_description text,
  ADD COLUMN IF NOT EXISTS source_tags text,
  ADD COLUMN IF NOT EXISTS source_category_name text,
  ADD COLUMN IF NOT EXISTS source_status varchar(30),
  ADD COLUMN IF NOT EXISTS source_price numeric(14, 2),
  ADD COLUMN IF NOT EXISTS source_retail_price numeric(14, 2),
  ADD COLUMN IF NOT EXISTS source_cost_price numeric(14, 2),
  ADD COLUMN IF NOT EXISTS source_stock_qty integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_min_order_qty integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS source_unit varchar(30),
  ADD COLUMN IF NOT EXISTS source_shipping_fee numeric(14, 2),
  ADD COLUMN IF NOT EXISTS source_no_bundle_shipping boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_barcode varchar(100),
  ADD COLUMN IF NOT EXISTS source_thumbnail_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS source_detail_image_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS source_options jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS source_product_notice jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS source_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

CREATE INDEX IF NOT EXISTS marketplace_registration_profiles_source_idx
  ON marketplace_registration_profiles(user_id, source_type, source_updated_at DESC);
