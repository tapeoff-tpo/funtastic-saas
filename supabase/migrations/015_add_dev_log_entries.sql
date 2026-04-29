-- Migration 015: 개발로그 — 상철/기환/지은 3인 공동 기록
-- 사용자별 데이터가 아니라 팀 전체 공유. RLS 미적용 (관리자 메뉴 내부에서만 접근).

CREATE TABLE IF NOT EXISTS dev_log_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author VARCHAR(20) NOT NULL CHECK (author IN ('상철', '기환', '지은')),
  log_date DATE NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dev_log_entries_log_date_idx
  ON dev_log_entries (log_date DESC, created_at DESC);

COMMENT ON TABLE dev_log_entries IS '개발 작업 일지 — 팀 3인(상철/기환/지은) 공동 기록.';
