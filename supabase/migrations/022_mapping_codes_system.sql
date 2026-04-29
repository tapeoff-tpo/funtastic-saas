-- 사방넷 방식 매핑코드 시스템 (Phase B 스키마).
--
-- 설계:
--   * mapping_codes      — 셀러가 정의하는 통합 식별자 (예: "MC-A001")
--   * mapping_sources    — 마켓상품(±옵션) → 매핑코드 연결 (1차/2차 매핑 통합)
--   * mapping_components — 매핑코드 → 내부 SKU + 수량 (단품=1행, 세트=N행)
--
-- 1차 매핑: marketplace_option_id 가 빈 문자열('') — 상품 단위 매핑
-- 2차 매핑: marketplace_option_id 가 비어있지 않음 — 옵션 단위 매핑
-- (NULL 대신 '' 을 사용하는 이유: Postgres unique constraint 가 NULL 을 동등 비교
--  하지 않아 중복 방지가 깨짐. 빈 문자열로 정규화하여 단순 unique 로 처리.)

-- ─── mapping_codes ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mapping_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code VARCHAR(100) NOT NULL,
  name TEXT NOT NULL,
  note TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, code)
);

CREATE INDEX IF NOT EXISTS mapping_codes_user_active_idx
  ON mapping_codes (user_id, is_active);

-- ─── mapping_sources ─────────────────────────────────────────────
-- 1 마켓상품/옵션 = 1 매핑코드. 이미 다른 코드에 매핑돼 있으면 unique 위반으로 알림.
CREATE TABLE IF NOT EXISTS mapping_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mapping_code_id UUID NOT NULL REFERENCES mapping_codes(id) ON DELETE CASCADE,
  marketplace_id VARCHAR(50) NOT NULL,
  marketplace_product_id VARCHAR(100) NOT NULL,
  marketplace_option_id VARCHAR(100) NOT NULL DEFAULT '',
  product_name_snapshot TEXT,
  option_name_snapshot TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, marketplace_id, marketplace_product_id, marketplace_option_id)
);

CREATE INDEX IF NOT EXISTS mapping_sources_code_id_idx
  ON mapping_sources (mapping_code_id);
CREATE INDEX IF NOT EXISTS mapping_sources_user_market_idx
  ON mapping_sources (user_id, marketplace_id);

-- ─── mapping_components ──────────────────────────────────────────
-- 매핑코드 1개가 N개의 SKU 를 가질 수 있다 (세트 구성).
-- inventory.sku 와 FK 로 묶지 않는다 — sku 변경/삭제 자유롭게 두기 위함.
CREATE TABLE IF NOT EXISTS mapping_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mapping_code_id UUID NOT NULL REFERENCES mapping_codes(id) ON DELETE CASCADE,
  sku VARCHAR(100) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, mapping_code_id, sku)
);

CREATE INDEX IF NOT EXISTS mapping_components_code_id_idx
  ON mapping_components (mapping_code_id);
CREATE INDEX IF NOT EXISTS mapping_components_user_sku_idx
  ON mapping_components (user_id, sku);
