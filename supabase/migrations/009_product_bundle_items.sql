-- 세트상품 구성 테이블
-- bundle_sku: 세트상품 SKU (orders에서 들어오는 SKU)
-- component_sku: 실제 차감할 구성품 SKU
-- quantity: 세트 1개당 구성품 수량
CREATE TABLE IF NOT EXISTS product_bundle_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bundle_sku VARCHAR(100) NOT NULL,
  component_sku VARCHAR(100) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, bundle_sku, component_sku)
);

CREATE INDEX IF NOT EXISTS product_bundle_items_user_bundle ON product_bundle_items (user_id, bundle_sku);
