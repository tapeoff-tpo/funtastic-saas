CREATE TABLE IF NOT EXISTS china_fund_statement_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  import_batch_id uuid NOT NULL,
  occurred_on date NOT NULL,
  sequence integer NOT NULL CHECK (sequence >= 0),
  direction varchar(30) NOT NULL CHECK (
    direction IN ('china_advance', 'our_remittance')
  ),
  signed_amount_cny numeric(16, 2) NOT NULL CHECK (signed_amount_cny <> 0),
  balance_after_cny numeric(16, 2) NOT NULL,
  source_key varchar(255) NOT NULL,
  source_label text,
  memo text,
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  voided_at timestamptz,
  voided_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP INDEX IF EXISTS china_fund_statement_entries_user_source_key;

CREATE UNIQUE INDEX IF NOT EXISTS china_fund_statement_entries_user_active_source_key
ON china_fund_statement_entries(user_id, source_key)
WHERE voided_at IS NULL;

CREATE INDEX IF NOT EXISTS china_fund_statement_entries_user_date_created_sequence
ON china_fund_statement_entries(user_id, occurred_on, created_at, sequence);

ALTER TABLE china_fund_statement_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE china_fund_statement_entries FROM anon, authenticated;
