-- Restore orders that were already mapped and had a failed invoice upload,
-- but were later downgraded to new by marketplace recollection.
WITH failed_invoice_orders AS (
  SELECT
    s.order_id,
    BOOL_OR(s.shipped_at IS NOT NULL) AS has_scan
  FROM shipments s
  WHERE s.upload_status = 'failed'
    AND NULLIF(s.tracking_number, '') IS NOT NULL
  GROUP BY s.order_id
)
UPDATE orders o
SET
  status = CASE
    WHEN f.has_scan THEN 'ready'::order_status
    ELSE 'preparing'::order_status
  END,
  updated_at = NOW()
FROM failed_invoice_orders f
WHERE o.id = f.order_id
  AND o.status = 'new'
  AND o.mapped_at IS NOT NULL
  AND o.is_held = FALSE;
