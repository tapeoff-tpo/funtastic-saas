-- inventory 테이블에 option_name(단품명) 컬럼 추가
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS option_name VARCHAR(200);
