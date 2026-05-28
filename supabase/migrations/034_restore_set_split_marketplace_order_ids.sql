-- Restore marketplace order numbers on existing set-split copy orders.
-- Set-split copies must share the original marketplace_order_id; only internal_no is unique.
UPDATE orders
SET
  marketplace_order_id = regexp_replace(marketplace_order_id, '-set-[0-9]+-[a-z0-9]+$', ''),
  updated_at = NOW()
WHERE is_copy = TRUE
  AND raw_data ? 'setSplit'
  AND marketplace_order_id ~ '-set-[0-9]+-[a-z0-9]+$';
