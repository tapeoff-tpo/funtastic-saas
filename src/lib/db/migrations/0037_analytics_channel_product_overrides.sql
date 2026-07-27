CREATE TABLE IF NOT EXISTS analytics_channel_product_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  channel_key varchar(100) NOT NULL,
  channel_name varchar(150) NOT NULL,
  channel_product_id varchar(120) NOT NULL,
  source_key varchar(140) NOT NULL,
  product_name text NOT NULL,
  option_name text,
  components jsonb NOT NULL DEFAULT '[]'::jsonb,
  sale_price numeric(12, 2) NOT NULL,
  regular_price numeric(12, 2),
  shipping_fee numeric(12, 2) NOT NULL DEFAULT 0,
  commission_rate numeric(7, 4) NOT NULL,
  registered_stock integer NOT NULL DEFAULT 0,
  sale_status varchar(50) NOT NULL,
  last_checked_at date NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS analytics_channel_product_overrides_unique
  ON analytics_channel_product_overrides (user_id, channel_key, channel_product_id, source_key);
CREATE INDEX IF NOT EXISTS analytics_channel_product_overrides_user_channel_idx
  ON analytics_channel_product_overrides (user_id, channel_key);
