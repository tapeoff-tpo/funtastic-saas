-- carrier_templates: carrier_id 를 선택 항목으로 변경.
-- 양식이 특정 택배사에 종속되지 않도록 NULL 허용.
-- 기존 데이터(택배사 종속 양식)는 그대로 유지된다.

ALTER TABLE carrier_templates
  ALTER COLUMN carrier_id DROP NOT NULL;
