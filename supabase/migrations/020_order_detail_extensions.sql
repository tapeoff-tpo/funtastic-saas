-- 020_order_detail_extensions.sql
-- 주문상세 페이지 확장에 필요한 컬럼/테이블 추가
--
-- 1. 전화번호2 (휴대폰) — 기존 buyer/recipient_phone 은 일반전화 의미로 유지, 휴대폰은 phone2 에 저장.
--    표시 우선순위: phone2 (휴대폰) → phone (일반전화)
-- 2. 매핑 audit — 매핑 적용 시점/사용자 추적
-- 3. 출고준비 전환 시점 추적 — status='preparing' 으로 전환된 시점 (orders.updated_at 은 마지막 변경이라 부정확)
-- 4. scan_logs — 바코드 스캔 이력 (정상/중복/비정상 모두 기록, 스캔자 추적)

-- 1) 전화번호2 (휴대폰)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS buyer_phone2 VARCHAR(50),
  ADD COLUMN IF NOT EXISTS recipient_phone2 VARCHAR(50);

COMMENT ON COLUMN orders.buyer_phone IS '구매자 전화번호1 (일반전화/집전화)';
COMMENT ON COLUMN orders.buyer_phone2 IS '구매자 전화번호2 (휴대폰) — 기본 표기용';
COMMENT ON COLUMN orders.recipient_phone IS '수령인 전화번호1 (일반전화/집전화)';
COMMENT ON COLUMN orders.recipient_phone2 IS '수령인 전화번호2 (휴대폰) — 기본 표기용';

-- 2) 매핑 audit
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS mapped_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS mapped_by_user_id UUID;

COMMENT ON COLUMN orders.mapped_at IS '매핑 적용 시점 (apply-mappings API 실행 시각)';
COMMENT ON COLUMN orders.mapped_by_user_id IS '매핑을 적용한 사용자 ID';

-- 3) 출고준비 전환 시점
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS preparing_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN orders.preparing_at IS '출고준비(preparing) 상태로 전환된 시점';

-- 4) scan_logs 테이블
CREATE TABLE IF NOT EXISTS scan_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  shipment_id UUID REFERENCES shipments(id) ON DELETE SET NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  tracking_number VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('ok', 'duplicate', 'not_found')),
  scanned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE scan_logs IS '바코드 스캔 이력 — 정상/중복/비정상 모두 기록';
COMMENT ON COLUMN scan_logs.status IS 'ok=정상, duplicate=중복, not_found=비정상';

CREATE INDEX IF NOT EXISTS scan_logs_order_id_idx ON scan_logs(order_id);
CREATE INDEX IF NOT EXISTS scan_logs_shipment_id_idx ON scan_logs(shipment_id);
CREATE INDEX IF NOT EXISTS scan_logs_user_id_scanned_at_idx ON scan_logs(user_id, scanned_at DESC);
