CREATE TABLE IF NOT EXISTS marketplace_settlement_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  marketplace_id varchar(50) NOT NULL,
  payout_delay_days integer NOT NULL DEFAULT 14,
  commission_rate numeric(7,4),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, marketplace_id)
);

CREATE TABLE IF NOT EXISTS marketplace_settlement_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  marketplace_id varchar(50) NOT NULL,
  settlement_date date NOT NULL,
  actual_amount numeric(14,2) NOT NULL,
  memo text,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, marketplace_id, settlement_date)
);

CREATE INDEX IF NOT EXISTS marketplace_settlement_rules_user_idx
  ON marketplace_settlement_rules(user_id, marketplace_id);
CREATE INDEX IF NOT EXISTS marketplace_settlement_confirmations_user_date_idx
  ON marketplace_settlement_confirmations(user_id, settlement_date);
