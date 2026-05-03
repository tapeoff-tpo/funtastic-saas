-- Prevent exact duplicate marketplace order item rows.
--
-- Some marketplace/history imports can legitimately reuse the same marketplace_item_id
-- for different options/SKUs, so the guard is intentionally on the full item identity
-- rather than marketplace_item_id alone.

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        order_id,
        marketplace_item_id,
        product_name,
        COALESCE(option_text, ''),
        quantity,
        unit_price,
        COALESCE(sku, ''),
        sku_multiplier,
        COALESCE(fulfillment_code, '')
      ORDER BY id
    ) AS rn
  FROM order_items
  WHERE marketplace_item_id IS NOT NULL
    AND marketplace_item_id <> ''
)
DELETE FROM order_items oi
USING ranked r
WHERE oi.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS order_items_unique_marketplace_line
  ON order_items (
    order_id,
    marketplace_item_id,
    product_name,
    COALESCE(option_text, ''),
    quantity,
    unit_price,
    COALESCE(sku, ''),
    sku_multiplier,
    COALESCE(fulfillment_code, '')
  )
  WHERE marketplace_item_id IS NOT NULL
    AND marketplace_item_id <> '';
