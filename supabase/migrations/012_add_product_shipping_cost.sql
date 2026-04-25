ALTER TABLE products
  ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC(12,2);

COMMENT ON COLUMN products.shipping_cost IS 'SaaS 등록 배송비(원가) — 재고관리에서 입력. NULL 허용 (CONTEXT.md D-05).';
