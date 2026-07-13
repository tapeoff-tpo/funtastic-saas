CREATE TABLE IF NOT EXISTS analytics_price_table_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_file_name varchar(255),
  source_sheet_name varchar(100) NOT NULL,
  row_number integer NOT NULL,
  product_code varchar(100),
  product_name text,
  option_name text,
  registered_product_name text,
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analytics_price_table_rows_user_imported_idx
  ON analytics_price_table_rows (user_id, imported_at);

CREATE INDEX IF NOT EXISTS analytics_price_table_rows_user_sheet_idx
  ON analytics_price_table_rows (user_id, source_sheet_name);

CREATE INDEX IF NOT EXISTS analytics_price_table_rows_user_product_code_idx
  ON analytics_price_table_rows (user_id, product_code);
