import { describe, expect, it, vi } from 'vitest'
import { saasChinaInventory } from '@/lib/db/schema'

vi.mock('@/lib/db', () => ({ db: {} }))

import {
  buildSaasChinaInventoryWorkbookPreview,
  type SaasChinaInventoryWorkbookPreview,
} from './saas-china-outbound'
import type { SaasChinaInventoryExcelRow } from './saas-china-inventory-excel'

type Inventory = typeof saasChinaInventory.$inferSelect
const inventoryId = '11111111-1111-4111-8111-111111111111'

function inventory(overrides: Partial<Inventory> = {}): Inventory {
  return {
    id: inventoryId,
    userId: 'workspace-a',
    warehouseCode: '중국창고',
    sku: 'SKU-A',
    productName: '기존 상품명',
    optionKey: '',
    optionName: null,
    onHandQuantity: 10,
    reservedQuantity: 4,
    availableQuantity: 6,
    lastReceivedAt: null,
    lastOutboundAt: null,
    createdBy: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  }
}

function row(overrides: Partial<SaasChinaInventoryExcelRow> = {}): SaasChinaInventoryExcelRow {
  return {
    rowNumber: 2,
    inventoryId: null,
    warehouseCode: '중국창고',
    sku: 'SKU-A',
    productName: null,
    optionName: null,
    optionKey: '',
    onHandQuantity: 7,
    note: null,
    errors: [],
    ...overrides,
  }
}

function preview(rows: SaasChinaInventoryExcelRow[], inventories: Inventory[] = [inventory()], linked = new Map<string, number>()) {
  return buildSaasChinaInventoryWorkbookPreview({
    userId: 'workspace-a',
    rows,
    inventories,
    linkedOnHandByInventoryId: linked,
  })
}

describe('SaaS China inventory Excel planner', () => {
  it('treats current stock as an absolute target and preserves a blank existing product name', () => {
    const result = preview([row({ onHandQuantity: 7, productName: null })])

    expect(result.summary).toEqual({ newCount: 0, changedCount: 1, unchangedCount: 0, invalidCount: 0, rowCount: 1 })
    expect(result.rows).toEqual([expect.objectContaining({
      beforeQuantity: 10,
      afterQuantity: 7,
      productName: '기존 상품명',
      status: 'changed',
    })])
  })

  it('keeps blank quantities unchanged and does not infer deletes from absent workbook identities', () => {
    const result = preview([row({ onHandQuantity: null })], [
      inventory(),
      inventory({ id: 'inventory-b', sku: 'SKU-B', productName: '엑셀에 없는 재고', onHandQuantity: 5, reservedQuantity: 0, availableQuantity: 5 }),
    ])

    expect(result.summary).toEqual({ newCount: 0, changedCount: 0, unchangedCount: 1, invalidCount: 0, rowCount: 1 })
    expect(result.rows[0]).toEqual(expect.objectContaining({ beforeQuantity: 10, afterQuantity: 10, status: 'unchanged' }))
  })

  it('allows a new identity only with a positive target and product name', () => {
    const result = preview([
      row({ sku: 'NEW-SKU', productName: '새 상품', onHandQuantity: 20 }),
      row({ rowNumber: 3, sku: 'ZERO-SKU', productName: '0 재고', onHandQuantity: 0 }),
      row({ rowNumber: 4, sku: 'NO-NAME', productName: null, onHandQuantity: 2 }),
    ])

    expect(result.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 2, status: 'new', afterQuantity: 20 }),
      expect.objectContaining({ row: 3, status: 'invalid', message: '새 재고는 현재고를 1개 이상 입력해주세요.' }),
      expect.objectContaining({ row: 4, status: 'invalid', message: '새 재고는 상품명을 입력해주세요.' }),
    ]))
    expect(result.summary).toEqual({ newCount: 1, changedCount: 0, unchangedCount: 0, invalidCount: 2, rowCount: 3 })
  })

  it('blocks a target below an outbound reservation or still-linked purchase quantity', () => {
    const reservation = preview([row({ onHandQuantity: 3 })])
    expect(reservation.rows[0]).toEqual(expect.objectContaining({
      status: 'protected',
      message: '출고 예약 4개보다 적게 줄일 수 없습니다.',
    }))

    const linked = preview([row({ onHandQuantity: 7 })], [inventory({ reservedQuantity: 0, availableQuantity: 10 })], new Map([[inventoryId, 8]]))
    expect(linked.rows[0]).toEqual(expect.objectContaining({
      status: 'protected',
      message: '발주 연동 재고 8개보다 적게 줄일 수 없습니다.',
    }))
  })

  it('rejects duplicate identities even when an API caller bypasses workbook parsing', () => {
    const result: SaasChinaInventoryWorkbookPreview = preview([
      row({ sku: 'DUPLICATE', productName: '상품 A', onHandQuantity: 1 }),
      row({ rowNumber: 3, sku: 'DUPLICATE', productName: '상품 B', onHandQuantity: 2 }),
    ])

    expect(result.summary.invalidCount).toBe(2)
    expect(result.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 2, status: 'invalid' }),
      expect.objectContaining({ row: 3, status: 'invalid' }),
    ]))
  })

  it.each([
    ['중국창고', '다른 중국창고'],
    ['품목코드', 'EDITED-SKU'],
    ['옵션명', '변경 옵션'],
  ] as const)('rejects an exported inventory row when its %s is edited', (_label, value) => {
    const overrides = _label === '중국창고'
      ? { warehouseCode: value }
      : _label === '품목코드'
        ? { sku: value }
        : { optionName: value }
    const result = preview([row({ inventoryId, ...overrides })])

    expect(result.summary).toEqual({ newCount: 0, changedCount: 0, unchangedCount: 0, invalidCount: 1, rowCount: 1 })
    expect(result.rows[0]).toEqual(expect.objectContaining({
      status: 'invalid',
      message: '현재 목록에서 내려받은 중국창고·품목코드·옵션명은 변경할 수 없습니다.',
    }))
  })

  it('rejects an unknown inventory ID, including an ID from another workspace', () => {
    const foreignInventoryId = '22222222-2222-4222-8222-222222222222'
    const result = preview([row({ inventoryId: foreignInventoryId })], [
      inventory(),
      inventory({
        id: foreignInventoryId,
        userId: 'workspace-b',
        warehouseCode: '다른 중국창고',
        sku: 'FOREIGN-SKU',
      }),
    ])

    expect(result.summary).toEqual({ newCount: 0, changedCount: 0, unchangedCount: 0, invalidCount: 1, rowCount: 1 })
    expect(result.rows[0]).toEqual(expect.objectContaining({
      status: 'invalid',
      message: '엑셀의 SaaS재고ID를 현재 목록에서 찾을 수 없습니다.',
    }))
  })
})
