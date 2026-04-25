CREATE TABLE IF NOT EXISTS inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  marketplace_id VARCHAR(50) NOT NULL,
  marketplace_inquiry_id VARCHAR(255) NOT NULL,
  marketplace_order_id VARCHAR(255),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  inquiry_type VARCHAR(50) NOT NULL,
  question TEXT NOT NULL,
  answered_at TIMESTAMPTZ,
  requested_at TIMESTAMPTZ NOT NULL,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS inquiries_user_market_external_uniq
  ON inquiries (user_id, marketplace_id, marketplace_inquiry_id);

CREATE INDEX IF NOT EXISTS inquiries_order_id_idx ON inquiries (order_id);
CREATE INDEX IF NOT EXISTS inquiries_user_marketplace_idx ON inquiries (user_id, marketplace_id);

COMMENT ON TABLE inquiries IS '마켓플레이스 문의 수집 (Phase 8 — Coupang 우선, Naver 별도 quick).';
COMMENT ON COLUMN inquiries.inquiry_type IS 'product | callcenter | online (Coupang 3종)';
