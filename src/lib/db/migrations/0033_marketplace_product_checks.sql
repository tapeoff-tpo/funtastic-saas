CREATE TABLE IF NOT EXISTS analytics_marketplace_product_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  product_code varchar(100) NOT NULL,
  marketplace_key varchar(100) NOT NULL,
  marketplace_name varchar(150) NOT NULL,
  account_key varchar(150) NOT NULL DEFAULT 'default',
  status varchar(30) NOT NULL,
  marketplace_product_id varchar(300),
  marketplace_product_name text,
  seller_url text,
  source varchar(30) NOT NULL DEFAULT 'browser_extension',
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS analytics_marketplace_checks_unique
  ON analytics_marketplace_product_checks (user_id, product_code, marketplace_key, account_key);
CREATE INDEX IF NOT EXISTS analytics_marketplace_checks_user_market_idx
  ON analytics_marketplace_product_checks (user_id, marketplace_key);
CREATE INDEX IF NOT EXISTS analytics_marketplace_checks_user_product_idx
  ON analytics_marketplace_product_checks (user_id, product_code);
