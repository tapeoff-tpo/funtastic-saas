DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'china_purchase_fund_transaction_type') THEN
    CREATE TYPE public.china_purchase_fund_transaction_type AS ENUM (
      'transfer_in', 'purchase_out', 'adjustment_in', 'adjustment_out'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.china_purchase_fund_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  transaction_date date NOT NULL,
  type public.china_purchase_fund_transaction_type NOT NULL,
  amount_cny numeric(14, 2) NOT NULL,
  amount_krw numeric(14, 0),
  exchange_rate numeric(12, 4),
  memo text,
  created_by_user_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS china_purchase_fund_transactions_user_date
  ON public.china_purchase_fund_transactions (user_id, transaction_date);
