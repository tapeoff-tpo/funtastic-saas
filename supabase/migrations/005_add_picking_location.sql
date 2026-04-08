-- Add picking location fields to inventory table
ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS warehouse_zone VARCHAR(100),
  ADD COLUMN IF NOT EXISTS sector_code VARCHAR(100);

COMMENT ON COLUMN inventory.warehouse_zone IS '창고 분류 (예: 1창고, 쿠팡전용창고, 중국창고)';
COMMENT ON COLUMN inventory.sector_code IS '피킹 섹터/위치 코드 (예: A-01, B-12)';
