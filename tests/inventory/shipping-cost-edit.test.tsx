import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('inventory shipping_cost edit', () => {
  it('updateShippingCost server action이 존재한다', () => {
    const actions = readFileSync('src/app/(auth)/inventory/actions.ts', 'utf8')
    expect(actions).toMatch(/updateShippingCost/)
  })
  it.todo('재고 행에서 shipping_cost 입력 → onBlur로 server action 호출 → DB 반영')
  it.todo('비숫자 입력은 거부 (NULL 또는 이전 값 유지)')
})
