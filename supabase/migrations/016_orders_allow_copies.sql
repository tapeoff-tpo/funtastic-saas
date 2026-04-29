-- 주문 복사 시 marketplace_order_id 를 원본과 동일하게 유지하기 위한 변경.
-- is_copy=true 인 행은 unique 제약에서 제외 → 같은 번호로 N개 복사 가능.
-- 마켓 동기화 upsert 는 is_copy=false 만 대상으로 삼아 그대로 동작.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS is_copy BOOLEAN NOT NULL DEFAULT FALSE;

DROP INDEX IF EXISTS orders_marketplace_unique;

CREATE UNIQUE INDEX orders_marketplace_unique
  ON orders (marketplace_id, marketplace_order_id)
  WHERE is_copy = FALSE;
