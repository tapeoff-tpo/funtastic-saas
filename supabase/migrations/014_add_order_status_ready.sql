-- Migration 014: Add 'ready' status to order_status enum
-- '출고준비' — 출고대기(preparing)에서 바코드 스캔 완료 후 진입.

ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'ready' BEFORE 'shipped';
