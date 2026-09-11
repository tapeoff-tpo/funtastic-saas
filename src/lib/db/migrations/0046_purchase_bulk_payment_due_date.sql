ALTER TABLE purchase_request_items
  ADD COLUMN IF NOT EXISTS bulk_payment_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bulk_payment_due_date date;
