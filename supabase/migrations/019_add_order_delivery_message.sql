-- 배송메세지 (구매자가 마켓에서 입력한 배송 메모) 저장 컬럼 추가
-- 쿠팡 parcelPrintMessage 가 대표적. 다른 마켓은 어댑터 확장 시 매핑.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_message VARCHAR(500);

COMMENT ON COLUMN orders.delivery_message IS '배송메세지 — 구매자가 마켓에서 입력한 배송 요청사항 (예: 쿠팡 parcelPrintMessage). 물류메세지(logistics_message) 와 구분됨.';

-- 기존 쿠팡 주문 백필: rawData.parcelPrintMessage 에서 추출
UPDATE orders
SET delivery_message = raw_data->>'parcelPrintMessage'
WHERE marketplace_id = 'coupang'
  AND delivery_message IS NULL
  AND raw_data->>'parcelPrintMessage' IS NOT NULL
  AND raw_data->>'parcelPrintMessage' <> '';
