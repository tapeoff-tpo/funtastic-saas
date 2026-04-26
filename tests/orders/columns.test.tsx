import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const src = readFileSync('src/app/(auth)/orders/columns.tsx', 'utf8')

describe('columns.tsx — phase 8 file-content assertions', () => {
  it('CS 헤더 컬럼이 제거되었다', () => {
    expect(src).not.toMatch(/header:\s*['"`]CS['"`]/)
    // 'cs' id 컬럼도 사라졌다
    expect(src).not.toMatch(/id:\s*['"`]cs['"`]/)
  })

  it('배송구분 컬럼이 추가되었다', () => {
    expect(src).toMatch(/header:\s*['"`]배송구분['"`]/)
  })

  it('배송비 (수집/등록) 통합 컬럼이 추가되었다', () => {
    expect(src).toMatch(/header:\s*['"`]배송비 \(수집\/등록\)['"`]/)
    // 셀 내부에 shippingFee + shippingCost 둘 다 참조
    expect(src).toMatch(/shippingFee/)
    expect(src).toMatch(/shippingCost/)
  })

  it('displayName fallback 패턴 사용 (displayName ?? productName)', () => {
    expect(src).toMatch(/displayName\s*\?\?\s*[a-zA-Z.]*productName/)
  })

  it('hasInquiries 인디케이터 렌더링 (MessageCircle 또는 문의 텍스트)', () => {
    expect(src).toMatch(/hasInquiries/)
    expect(src).toMatch(/MessageCircle|문의/)
  })

  it('holdReason 인디케이터가 보존된다 (Pitfall 3)', () => {
    expect(src).toMatch(/holdReason/)
  })

  it('claimType 뱃지 (취소|교환|반품 라벨)', () => {
    expect(src).toMatch(/취소|교환|반품/)
  })

  it('lucide MessageCircle / Lock 아이콘이 import되어 있다', () => {
    expect(src).toMatch(/from\s+['"]lucide-react['"]/)
    expect(src).toMatch(/MessageCircle/)
    expect(src).toMatch(/Lock/)
  })
})
