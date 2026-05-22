-- 주문관리 검색/필터 성능 보강
-- 필터 변경 시 orders 목록 + count + 품목/송장/클레임 보조 조회가 반복 실행되므로
-- 실제 WHERE/ORDER BY/EXISTS 패턴에 맞춘 인덱스를 추가한다.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 상태/마켓/날짜 탭 필터: user_id scope 안에서 status/marketplace/date 조합으로 정렬/페이지네이션.
CREATE INDEX IF NOT EXISTS orders_user_status_ordered_at
  ON orders (user_id, status, ordered_at DESC);

CREATE INDEX IF NOT EXISTS orders_user_marketplace_ordered_at
  ON orders (user_id, marketplace_id, ordered_at DESC);

CREATE INDEX IF NOT EXISTS orders_user_collected_at
  ON orders (user_id, collected_at DESC);

CREATE INDEX IF NOT EXISTS orders_user_ordered_at
  ON orders (user_id, ordered_at DESC);

-- 검색 필드. ilike '%...%' 검색은 btree가 잘 안 타므로 trigram GIN을 사용한다.
CREATE INDEX IF NOT EXISTS orders_marketplace_order_id_trgm
  ON orders USING gin (marketplace_order_id gin_trgm_ops);

CREATE INDEX IF NOT EXISTS orders_internal_no_trgm
  ON orders USING gin (internal_no gin_trgm_ops);

CREATE INDEX IF NOT EXISTS orders_buyer_name_trgm
  ON orders USING gin (buyer_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS orders_recipient_name_trgm
  ON orders USING gin (recipient_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS orders_recipient_phone_trgm
  ON orders USING gin (recipient_phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS orders_logistics_message_trgm
  ON orders USING gin (logistics_message gin_trgm_ops);

-- EXISTS / inArray(order_id) / 품목 검색.
CREATE INDEX IF NOT EXISTS order_items_order_id
  ON order_items (order_id);

CREATE INDEX IF NOT EXISTS order_items_sku
  ON order_items (sku);

CREATE INDEX IF NOT EXISTS order_items_sku_trgm
  ON order_items USING gin (sku gin_trgm_ops);

CREATE INDEX IF NOT EXISTS order_items_marketplace_item_id
  ON order_items (marketplace_item_id);

CREATE INDEX IF NOT EXISTS order_items_marketplace_item_id_trgm
  ON order_items USING gin (marketplace_item_id gin_trgm_ops);

CREATE INDEX IF NOT EXISTS order_items_product_name_trgm
  ON order_items USING gin (product_name gin_trgm_ops);

-- claims/shipments/scan_logs는 주문별 보조 조회와 EXISTS 필터에 자주 쓰인다.
CREATE INDEX IF NOT EXISTS claims_order_type_idx
  ON claims (order_id, claim_type);

CREATE INDEX IF NOT EXISTS shipments_order_created_idx
  ON shipments (order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS shipments_tracking_number_trgm
  ON shipments USING gin (tracking_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS scan_logs_order_status_scanned_idx
  ON scan_logs (order_id, status, scanned_at DESC);
