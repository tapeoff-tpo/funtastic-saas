-- Normalize legacy Sabangnet inventory names. New uploads are normalized in
-- application code; this migration keeps existing inventory and product rows
-- consistent for environments that apply Supabase migrations directly.

UPDATE inventory
SET product_name = COALESCE(
      NULLIF(
        BTRIM(REGEXP_REPLACE(REGEXP_REPLACE(product_name, '_펀타스틱', '', 'gi'), '_+$', '', 'g')),
        ''
      ),
      sku
    ),
    updated_at = now()
WHERE product_name ~* '_펀타스틱';

UPDATE products
SET name = COALESCE(
      NULLIF(
        BTRIM(REGEXP_REPLACE(REGEXP_REPLACE(name, '_펀타스틱', '', 'gi'), '_+$', '', 'g')),
        ''
      ),
      internal_sku
    ),
    updated_at = now()
WHERE name ~* '_펀타스틱';
