import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('orders page header', () => {
  it('주문관리 page.tsx에 "엑셀 업로드" 텍스트가 더 이상 없다', () => {
    const src = readFileSync('src/app/(auth)/orders/page.tsx', 'utf8')
    expect(src).not.toMatch(/엑셀 업로드/)
    expect(src).not.toMatch(/href="\/orders\/import"/)
  })
})
