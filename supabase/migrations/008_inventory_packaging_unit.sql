-- inventory 테이블에 packaging_unit(옵션별칭/박스단위) 컬럼 추가
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS packaging_unit VARCHAR(200);
