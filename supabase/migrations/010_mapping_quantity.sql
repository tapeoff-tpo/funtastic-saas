-- 매핑 멀티플라이어 지원
-- 마켓 상품 1개가 내부 SKU N개 분량일 때 (예: "A 2개입" 벌크팩)

ALTER TABLE product_name_mappings
  ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1
    CHECK (quantity > 0);

ALTER TABLE product_option_mappings
  ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1
    CHECK (quantity > 0);

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS sku_multiplier INTEGER NOT NULL DEFAULT 1
    CHECK (sku_multiplier > 0);
