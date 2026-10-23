ALTER TABLE purchase_request_items
  ADD COLUMN IF NOT EXISTS tracking_number varchar(100);
