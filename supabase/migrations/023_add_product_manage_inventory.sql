-- 023_add_product_manage_inventory.sql
-- 상품관리 → 재고관리 연동 플래그.
--
-- 사방넷 대체 워크플로우: 모든 상품이 재고관리 대상은 아니다.
-- 일부는 매입형, 일부는 위탁/드롭쉬핑이라 재고를 SaaS 에서 추적하지 않음.
-- products.manage_inventory = TRUE 인 상품만 재고관리 페이지에 노출되고,
-- 재고 차감/입고 대상에 포함된다.
--
-- 백필: 이미 inventory 행이 존재하는 (user_id, sku) 조합은
-- 사용자가 재고관리 대상으로 사용 중인 것이므로 자동으로 TRUE 처리.

ALTER TABLE products
  ADD COLUMN manage_inventory BOOLEAN NOT NULL DEFAULT FALSE;

-- 기존 inventory 데이터와 매칭되는 product 는 재고관리 대상으로 마크
UPDATE products p
SET manage_inventory = TRUE
WHERE EXISTS (
  SELECT 1
  FROM inventory i
  WHERE i.user_id = p.user_id
    AND i.sku = p.internal_sku
);

-- 재고관리 페이지에서 자주 필터링되므로 부분 인덱스
CREATE INDEX IF NOT EXISTS products_manage_inventory_user
  ON products (user_id)
  WHERE manage_inventory = TRUE;
