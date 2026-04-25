import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('inventory shipping_cost edit', () => {
  it('updateShippingCost server action exists with userId scope', () => {
    const src = readFileSync('src/app/(auth)/inventory/actions.ts', 'utf8')
    expect(src).toMatch(/['"]use server['"]/)
    expect(src).toMatch(/export\s+async\s+function\s+updateShippingCost/)
    expect(src).toMatch(/eq\(products\.userId,\s*user\.id\)/)
    expect(src).toMatch(/eq\(products\.id,\s*productId\)/)
  })
  it('updateShippingCost validates input (rejects NaN / negative)', () => {
    const src = readFileSync('src/app/(auth)/inventory/actions.ts', 'utf8')
    expect(src).toMatch(/Number\.isNaN|isNaN/)
    expect(src).toMatch(/value\s*>=\s*0|value\s*<\s*0/)
  })
  it('inventory-table renders ShippingCostCell for new column', () => {
    const src = readFileSync('src/app/(auth)/inventory/inventory-table.tsx', 'utf8')
    expect(src).toMatch(/ShippingCostCell/)
    expect(src).toMatch(/SaaS 배송비\(원가\)|배송비/)
  })
  it('ShippingCostCell uses useTransition + onBlur + updateShippingCost', () => {
    const src = readFileSync('src/app/(auth)/inventory/inventory-table.tsx', 'utf8')
    expect(src).toMatch(/useTransition/)
    expect(src).toMatch(/onBlur/)
    expect(src).toMatch(/updateShippingCost/)
  })
  it('page.tsx 데이터 페치에 shippingCost 포함', () => {
    const src = readFileSync('src/app/(auth)/inventory/page.tsx', 'utf8')
    expect(src).toMatch(/shippingCost/)
  })
})
