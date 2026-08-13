CREATE TABLE IF NOT EXISTS channel_sales_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  channel varchar(20) NOT NULL CHECK (channel IN ('rocket', 'bulk')),
  source_file_name varchar(255) NOT NULL,
  file_hash varchar(64) NOT NULL,
  total_rows integer NOT NULL DEFAULT 0,
  valid_rows integer NOT NULL DEFAULT 0,
  invalid_rows integer NOT NULL DEFAULT 0,
  total_quantity integer NOT NULL DEFAULT 0,
  total_sales numeric(16, 4) NOT NULL DEFAULT 0,
  total_profit numeric(16, 4),
  period_start date,
  period_end date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, channel, file_hash)
);

CREATE TABLE IF NOT EXISTS channel_sales_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES channel_sales_batches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  channel varchar(20) NOT NULL CHECK (channel IN ('rocket', 'bulk')),
  row_number integer NOT NULL,
  occurred_on date NOT NULL,
  source_sku varchar(200),
  product_name text,
  option_text text,
  counterparty text,
  quantity integer NOT NULL,
  unit_sale_price numeric(16, 4),
  sales_amount numeric(16, 4) NOT NULL,
  product_cost numeric(16, 4),
  marketplace_fee numeric(16, 4),
  paid_shipping_fee numeric(16, 4),
  actual_shipping_fee numeric(16, 4),
  box_cost numeric(16, 4),
  profit_amount numeric(16, 4),
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS channel_sales_batches_user_created_idx
  ON channel_sales_batches(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS channel_sales_lines_user_date_channel_idx
  ON channel_sales_lines(user_id, occurred_on, channel);
CREATE INDEX IF NOT EXISTS channel_sales_lines_user_sku_date_idx
  ON channel_sales_lines(user_id, source_sku, occurred_on);

ALTER TABLE channel_sales_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_sales_lines ENABLE ROW LEVEL SECURITY;
