CREATE TABLE IF NOT EXISTS outbound_reflection_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_file_name varchar(255) NOT NULL,
  file_hash varchar(64) NOT NULL,
  total_rows integer NOT NULL DEFAULT 0,
  ready_rows integer NOT NULL DEFAULT 0,
  blocked_rows integer NOT NULL DEFAULT 0,
  applied_rows integer NOT NULL DEFAULT 0,
  excluded_rows integer NOT NULL DEFAULT 0,
  total_quantity integer NOT NULL DEFAULT 0,
  total_sales numeric(16, 4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  UNIQUE (user_id, file_hash)
);

CREATE TABLE IF NOT EXISTS outbound_reflection_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES outbound_reflection_batches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  row_number integer NOT NULL,
  source_key varchar(500) NOT NULL,
  source_order_number varchar(200) NOT NULL,
  shipment_date date NOT NULL,
  marketplace_name text,
  marketplace_id varchar(50),
  sku varchar(100),
  product_name text,
  option_text text,
  quantity integer NOT NULL DEFAULT 0,
  sales_amount numeric(16, 4) NOT NULL DEFAULT 0,
  shipping_fee numeric(16, 4),
  marketplace_fee numeric(16, 4),
  profit_amount numeric(16, 4),
  claim_type varchar(30),
  reflection_status varchar(30) NOT NULL DEFAULT 'blocked',
  issue_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  issue_messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, row_number)
);

CREATE INDEX IF NOT EXISTS outbound_reflection_batches_user_created_idx
  ON outbound_reflection_batches(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS outbound_reflection_lines_user_batch_status_idx
  ON outbound_reflection_lines(user_id, batch_id, reflection_status, row_number);
CREATE INDEX IF NOT EXISTS outbound_reflection_lines_user_date_idx
  ON outbound_reflection_lines(user_id, shipment_date, reflection_status);
CREATE UNIQUE INDEX IF NOT EXISTS outbound_reflection_applied_source_key_idx
  ON outbound_reflection_lines(user_id, source_key)
  WHERE reflection_status = 'applied';

ALTER TABLE outbound_reflection_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_reflection_lines ENABLE ROW LEVEL SECURITY;
