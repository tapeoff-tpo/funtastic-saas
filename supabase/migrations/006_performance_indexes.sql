-- 성능 최적화 인덱스
-- 1. pg_trgm: 한국어 포함 ilike '%검색어%' 속도 향상
-- 2. inventory_history 복합 인덱스: 월별 집계 속도 향상
-- 3. products 검색 최적화

-- pg_trgm 확장 활성화 (없으면 생성)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 상품명 trigram 검색 인덱스 (ilike '%상품명%' 최적화)
CREATE INDEX CONCURRENTLY IF NOT EXISTS products_name_trgm
  ON products USING gin(name gin_trgm_ops);

-- 상품코드 trigram 검색 인덱스
CREATE INDEX CONCURRENTLY IF NOT EXISTS products_sku_trgm
  ON products USING gin(internal_sku gin_trgm_ops);

-- inventory_history 복합 인덱스: 월별 입고/출고 집계 최적화
-- (inventory_id, adjustment_reason, created_at) → GROUP BY 쿼리 커버링 인덱스
CREATE INDEX CONCURRENTLY IF NOT EXISTS inventory_history_agg
  ON inventory_history(inventory_id, adjustment_reason, created_at);
