ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC(12,2);

COMMENT ON COLUMN orders.shipping_type IS '배송구분 (prepaid/cod/free/unknown enum). 마켓에서 수집된 결제 방식 (CONTEXT.md D-04).';
COMMENT ON COLUMN orders.shipping_fee IS '마켓에서 수집된 배송비 (KRW). NULL 허용 — 미수집/미존재 시.';
