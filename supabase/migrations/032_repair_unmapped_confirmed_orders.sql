-- 확인 탭은 로컬 매핑 확정이 끝난 주문만 사용한다.
-- 수집 예외 로직으로 잘못 올라간 미매핑 확인 주문을 신규로 되돌린다.
UPDATE orders
SET status = 'new',
    updated_at = now()
WHERE status = 'confirmed'
  AND mapped_at IS NULL;
