ALTER TABLE purchase_request_items
  ADD COLUMN IF NOT EXISTS payment_status varchar(30) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payment_paid_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS cost_exchange_rate_krw numeric(12, 4),
  ADD COLUMN IF NOT EXISTS cost_exchange_rate_date date;

CREATE INDEX IF NOT EXISTS purchase_request_items_user_payment_status
ON purchase_request_items(user_id, payment_status);
