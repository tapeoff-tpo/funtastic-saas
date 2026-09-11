CREATE TABLE IF NOT EXISTS purchase_fund_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  entry_type varchar(30) NOT NULL CHECK (
    entry_type IN ('deposit', 'opening_balance', 'purchase_debit')
  ),
  occurred_on date NOT NULL,
  amount_krw numeric(16, 2) NOT NULL DEFAULT 0 CHECK (amount_krw >= 0),
  amount_cny numeric(16, 2) CHECK (amount_cny IS NULL OR amount_cny >= 0),
  memo text,
  source_key varchar(255),
  supplier_order_number varchar(100),
  source_purchase_item_id uuid REFERENCES purchase_request_items(id) ON DELETE SET NULL,
  missing_cost_count integer NOT NULL DEFAULT 0 CHECK (missing_cost_count >= 0),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  voided_at timestamptz,
  voided_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS purchase_fund_entries_user_source_key
ON purchase_fund_entries(user_id, source_key);

CREATE INDEX IF NOT EXISTS purchase_fund_entries_user_occurred_on
ON purchase_fund_entries(user_id, occurred_on);

ALTER TABLE purchase_fund_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE purchase_fund_entries FROM anon, authenticated;
