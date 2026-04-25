import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('orders columns', () => {
  const src = readFileSync('src/app/(auth)/orders/columns.tsx', 'utf8')
  it('CS 헤더 컬럼이 제거되었다', () => {
    expect(src).not.toMatch(/header:\s*['"`]CS['"`]/)
    expect(src).not.toMatch(/accessorKey:\s*['"`]cs['"`]/)
  })
  it('배송구분/수집배송비/SaaS배송비 컬럼이 추가되었다', () => {
    expect(src).toMatch(/배송구분|shippingType/)
    expect(src).toMatch(/수집 배송비|shippingFee/)
    expect(src).toMatch(/SaaS 배송비|shippingCost/)
  })
  it.todo('첫 컬럼에 클레임 뱃지 + 문의 아이콘이 통합 렌더링된다')
  it.todo('items[].displayName 우선 표시, 원본명은 보조 표시')
})
