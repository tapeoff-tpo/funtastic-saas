/**
 * 내부 주문번호(internal_no) 생성 헬퍼.
 *
 * UUID 첫 8 hex 를 사용 — 4B 조합, 셀러당 수만 건 규모에서 충돌 거의 없음.
 * 충돌 시 호출 측에서 retry — 이 함수는 stateless.
 */
import { randomUUID } from 'node:crypto'

export function generateInternalNo(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8)
}
