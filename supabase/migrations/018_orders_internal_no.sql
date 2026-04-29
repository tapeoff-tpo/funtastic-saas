-- 018: orders.internal_no — 사용자에게 보이는 8자리 내부 주문번호
--
-- UUID PK (id) 는 그대로 유지하고, 화면/엑셀에 노출되는 짧은 ID 를 별도로 둔다.
-- 백필: 기존 행은 UUID 첫 8자리(hex) 그대로 사용 — 사실상 충돌 없음.
-- 신규: 애플리케이션에서 randomUUID().slice(0,8) 생성, conflict 시 재시도.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS internal_no varchar(8);

-- 기존 행 백필 — UUID 첫 8 hex 사용 (UUID 자체가 unique 이므로 사실상 충돌 없음)
UPDATE orders
SET internal_no = SUBSTRING(REPLACE(id::text, '-', ''), 1, 8)
WHERE internal_no IS NULL;

-- NOT NULL 강제
ALTER TABLE orders
  ALTER COLUMN internal_no SET NOT NULL;

-- 유저 단위 unique (다른 유저끼리 같은 short 가 나와도 무관)
CREATE UNIQUE INDEX IF NOT EXISTS orders_user_internal_no_unique
  ON orders (user_id, internal_no);
