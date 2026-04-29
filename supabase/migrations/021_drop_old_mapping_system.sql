-- 매핑 시스템 전면 재설계 (사방넷 매핑코드 방식 도입 전 단계).
--
-- 기존 3개 분리된 테이블을 모두 drop. 신규 mapping_codes / mapping_sources /
-- mapping_components 테이블은 다음 phase 에서 추가.
--
-- orders.mapped_at / mapped_by_user_id 컬럼은 그대로 유지 — 매핑 완료 시점
-- 기록은 신규 시스템에서도 동일하게 사용한다.

DROP TABLE IF EXISTS product_bundle_items CASCADE;
DROP TABLE IF EXISTS product_option_mappings CASCADE;
DROP TABLE IF EXISTS product_name_mappings CASCADE;
