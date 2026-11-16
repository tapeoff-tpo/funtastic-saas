-- Shared customer master data for Operations > Quotes.
-- Sales and quotes retain independent customer snapshots, so deleting a master
-- record only clears its optional foreign-key reference.

CREATE TABLE IF NOT EXISTS quote_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  client_name text NOT NULL DEFAULT '',
  representative_name text NOT NULL DEFAULT '',
  contact_name text NOT NULL DEFAULT '',
  contact_phone varchar(200) NOT NULL DEFAULT '',
  business_registration_number varchar(100) NOT NULL DEFAULT '',
  tax_invoice_email varchar(320) NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  recipient_name text NOT NULL DEFAULT '',
  recipient_title text NOT NULL DEFAULT '',
  recipient_phone varchar(200) NOT NULL DEFAULT '',
  delivery_message text NOT NULL DEFAULT '',
  memo text NOT NULL DEFAULT '',
  created_by_user_id uuid,
  updated_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quote_clients_user_name_idx
  ON quote_clients(user_id, client_name);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quote_clients_user_business_registration_idx
  ON quote_clients(user_id, business_registration_number);
--> statement-breakpoint

ALTER TABLE quote_sales
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES quote_clients(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quote_sales_user_customer_idx
  ON quote_sales(user_id, customer_id);
--> statement-breakpoint

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES quote_clients(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quotes_user_customer_idx
  ON quotes(user_id, customer_id);
--> statement-breakpoint

ALTER TABLE quote_clients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE quote_clients FROM anon, authenticated;
