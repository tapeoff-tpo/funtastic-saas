-- Shared sales, quote, and immutable item-cost snapshots used by Operations > Quotes.
-- Every operational row belongs to the canonical workspace owner (user_id); the
-- application records the editing actor separately on headers.

CREATE TABLE IF NOT EXISTS quote_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  client_id varchar(160) NOT NULL,
  sale_number varchar(80),
  sale_date date NOT NULL DEFAULT CURRENT_DATE,
  customer_name text NOT NULL DEFAULT '',
  contact_name text NOT NULL DEFAULT '',
  status varchar(30) NOT NULL DEFAULT 'pending',
  shipping_status varchar(30) NOT NULL DEFAULT 'pending',
  shipping_date date,
  payment_status varchar(30) NOT NULL DEFAULT 'unpaid',
  payment_date date,
  memo text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  subtotal_amount numeric(14, 2) NOT NULL DEFAULT 0,
  vat_amount numeric(14, 2) NOT NULL DEFAULT 0,
  total_amount numeric(14, 2) NOT NULL DEFAULT 0,
  total_cost numeric(14, 2) NOT NULL DEFAULT 0,
  gross_profit numeric(14, 2) NOT NULL DEFAULT 0,
  created_by_user_id uuid,
  updated_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (subtotal_amount >= 0),
  CHECK (vat_amount >= 0),
  CHECK (total_amount >= 0),
  CHECK (total_cost >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS quote_sales_user_client_id_unique
  ON quote_sales(user_id, client_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS quote_sales_user_sale_number_unique
  ON quote_sales(user_id, sale_number)
  WHERE sale_number IS NOT NULL AND btrim(sale_number) <> '';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quote_sales_user_date_updated_idx
  ON quote_sales(user_id, sale_date DESC, updated_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quote_sales_user_status_idx
  ON quote_sales(user_id, status, updated_at DESC);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS quote_sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  sale_id uuid NOT NULL REFERENCES quote_sales(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  sku varchar(100),
  product_name text NOT NULL DEFAULT '',
  option_name text NOT NULL DEFAULT '',
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric(14, 2) NOT NULL DEFAULT 0,
  unit_cost_snapshot numeric(14, 2) NOT NULL DEFAULT 0,
  vat_included boolean NOT NULL DEFAULT false,
  note text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (quantity >= 0),
  CHECK (unit_price >= 0),
  CHECK (unit_cost_snapshot >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quote_sale_items_sale_sort_idx
  ON quote_sale_items(sale_id, sort_order, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quote_sale_items_product_idx
  ON quote_sale_items(product_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quote_sale_items_user_sku_idx
  ON quote_sale_items(user_id, sku);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS quote_sale_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  sale_id uuid NOT NULL REFERENCES quote_sales(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  content_type varchar(160) NOT NULL DEFAULT 'application/octet-stream',
  file_size integer NOT NULL,
  file_data bytea NOT NULL,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (file_size > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quote_sale_attachments_sale_created_idx
  ON quote_sale_attachments(sale_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quote_sale_attachments_user_sale_idx
  ON quote_sale_attachments(user_id, sale_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  client_id varchar(160) NOT NULL,
  quote_number varchar(80),
  sale_id uuid REFERENCES quote_sales(id) ON DELETE SET NULL,
  issue_date date NOT NULL DEFAULT CURRENT_DATE,
  recipient text NOT NULL DEFAULT '',
  recipient_title text NOT NULL DEFAULT '',
  intro text NOT NULL DEFAULT '',
  supplier_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  subtotal_amount numeric(14, 2) NOT NULL DEFAULT 0,
  vat_amount numeric(14, 2) NOT NULL DEFAULT 0,
  total_amount numeric(14, 2) NOT NULL DEFAULT 0,
  print_count integer NOT NULL DEFAULT 0,
  last_printed_at timestamptz,
  created_by_user_id uuid,
  updated_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (subtotal_amount >= 0),
  CHECK (vat_amount >= 0),
  CHECK (total_amount >= 0),
  CHECK (print_count >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS quotes_user_client_id_unique
  ON quotes(user_id, client_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS quotes_user_quote_number_unique
  ON quotes(user_id, quote_number)
  WHERE quote_number IS NOT NULL AND btrim(quote_number) <> '';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quotes_user_issue_updated_idx
  ON quotes(user_id, issue_date DESC, updated_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quotes_user_sale_idx
  ON quotes(user_id, sale_id, updated_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quotes_sale_idx
  ON quotes(sale_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS quote_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  sale_item_id uuid REFERENCES quote_sale_items(id) ON DELETE SET NULL,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  sku varchar(100),
  product_name text NOT NULL DEFAULT '',
  option_name text NOT NULL DEFAULT '',
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric(14, 2) NOT NULL DEFAULT 0,
  unit_cost_snapshot numeric(14, 2) NOT NULL DEFAULT 0,
  vat_included boolean NOT NULL DEFAULT false,
  note text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (quantity >= 0),
  CHECK (unit_price >= 0),
  CHECK (unit_cost_snapshot >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quote_items_quote_sort_idx
  ON quote_items(quote_id, sort_order, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quote_items_sale_item_idx
  ON quote_items(sale_item_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quote_items_product_idx
  ON quote_items(product_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quote_items_user_sku_idx
  ON quote_items(user_id, sku);
--> statement-breakpoint

ALTER TABLE quote_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_sale_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE quote_sales, quote_sale_items, quote_sale_attachments, quotes, quote_items FROM anon, authenticated;

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS business_registration_number varchar(30) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS representative_name varchar(100) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS business_type varchar(200) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS business_item varchar(200) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bank_account text NOT NULL DEFAULT '';
