CREATE TABLE IF NOT EXISTS coupang_rocket_outbound_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_file_name varchar(255) NOT NULL,
  file_hash varchar(64) NOT NULL,
  total_rows integer NOT NULL DEFAULT 0,
  valid_rows integer NOT NULL DEFAULT 0,
  matched_rows integer NOT NULL DEFAULT 0,
  unmatched_rows integer NOT NULL DEFAULT 0,
  invalid_rows integer NOT NULL DEFAULT 0,
  duplicate_rows integer NOT NULL DEFAULT 0,
  period_start date,
  period_end date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, file_hash)
);

CREATE TABLE IF NOT EXISTS coupang_rocket_outbound_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES coupang_rocket_outbound_batches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  row_number integer NOT NULL,
  source_row_numbers jsonb NOT NULL DEFAULT '[]'::jsonb,
  shipped_on date NOT NULL,
  source_order_id varchar(200) NOT NULL,
  source_sku varchar(200),
  sku varchar(100),
  product_name text,
  quantity integer NOT NULL,
  source_key varchar(64) NOT NULL,
  metric_included boolean NOT NULL DEFAULT false,
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coupang_rocket_outbound_batches_user_created_idx
  ON coupang_rocket_outbound_batches(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS coupang_rocket_outbound_lines_user_metric_date_idx
  ON coupang_rocket_outbound_lines(user_id, metric_included, shipped_on);
CREATE INDEX IF NOT EXISTS coupang_rocket_outbound_lines_user_sku_date_idx
  ON coupang_rocket_outbound_lines(user_id, sku, shipped_on);
CREATE INDEX IF NOT EXISTS coupang_rocket_outbound_lines_user_source_key_idx
  ON coupang_rocket_outbound_lines(user_id, source_key);
