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
    archivedAt: null,
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

function preview(
  rows: SaasChinaInventoryExcelRow[],
  inventories: Inventory[] = [inventory()],
  linked = new Map<string, number>(),
  options: { fullSnapshot?: boolean; snapshotWarehouseCodes?: string[] } = {},
) {
  return buildSaasChinaInventoryWorkbookPreview({
    userId: 'workspace-a',
    rows,
    inventories,
    linkedOnHandByInventoryId: linked,
    ...options,
  })
}

describe('SaaS China inventory Excel planner', () => {
  it('treats current stock as an absolute target and preserves a blank existing product name', () => {
    const result = preview([row({ onHandQuantity: 7, productName: null })])

    expect(result.summary).toEqual({ newCount: 0, changedCount: 1, unchangedCount: 0, removedCount: 0, invalidCount: 0, rowCount: 1 })
    expect(result.rows).toEqual([expect.objectContaining({
      beforeQuantity: 10,
      afterQuantity: 7,
      productName: '기존 상품명',
      status: 'changed',
    })])
  })

  it('keeps blank quantities unchanged and does not infer deletes from absent workbook identities in the partial-update template', () => {
    const result = preview([row({ onHandQuantity: null })], [
      inventory(),
      inventory({ id: 'inventory-b', sku: 'SKU-B', productName: '엑셀에 없는 재고', onHandQuantity: 5, reservedQuantity: 0, availableQuantity: 5 }),
    ])

    expect(result.summary).toEqual({ newCount: 0, changedCount: 0, unchangedCount: 1, removedCount: 0, invalidCount: 0, rowCount: 1 })
    expect(result.rows[0]).toEqual(expect.objectContaining({ beforeQuantity: 10, afterQuantity: 10, status: 'unchanged' }))
  })

  it('uses a blank inventory-status China quantity as a zero target only for an existing SaaS row', () => {
    const zeroExisting = preview([
      row({ onHandQuantity: 0, reportBlankQuantity: true }),
    ], [inventory({ reservedQuantity: 0, availableQuantity: 10 })])
    expect(zeroExisting.summary).toEqual({ newCount: 0, changedCount: 1, unchangedCount: 0, removedCount: 0, invalidCount: 0, rowCount: 1 })
    expect(zeroExisting.rows[0]).toEqual(expect.objectContaining({
      beforeQuantity: 10,
      afterQuantity: 0,
      status: 'changed',
      message: '재고현황의 빈 중국창고 수량을 0으로 변경합니다.',
    }))

    const absentInventory = preview([
      row({ sku: 'NOT-YET-TRACKED', productName: '미등록 상품', onHandQuantity: 0, reportBlankQuantity: true }),
    ], [])
    expect(absentInventory.summary).toEqual({ newCount: 0, changedCount: 0, unchangedCount: 1, removedCount: 0, invalidCount: 0, rowCount: 1 })
    expect(absentInventory.rows[0]).toEqual(expect.objectContaining({
      beforeQuantity: null,
      afterQuantity: 0,
      status: 'unchanged',
      message: '재고현황의 빈 중국창고 수량입니다. 현재 SaaS 재고가 없어 신규 등록하지 않습니다.',
    }))

    const protectedQuantity = preview([
      row({ onHandQuantity: 0, reportBlankQuantity: true }),
    ])
    expect(protectedQuantity.rows[0]).toEqual(expect.objectContaining({
      status: 'protected',
      message: '출고 예약 4개보다 적게 줄일 수 없습니다.',
    }))
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
    expect(result.summary).toEqual({ newCount: 1, changedCount: 0, unchangedCount: 0, removedCount: 0, invalidCount: 2, rowCount: 3 })
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

  it('reconciles a full inventory-status snapshot by removing omitted default-warehouse identities', () => {
    const result = preview([
      row({ onHandQuantity: 10, productName: '기존 상품명' }),
    ], [
      inventory(),
      inventory({
        id: 'inventory-b',
        sku: 'SKU-B',
        productName: '파일에 없는 기존 재고',
        onHandQuantity: 5,
        reservedQuantity: 0,
        availableQuantity: 5,
      }),
    ], new Map(), {
      fullSnapshot: true,
      snapshotWarehouseCodes: ['중국창고'],
    })

    expect(result.summary).toEqual({ newCount: 0, changedCount: 0, unchangedCount: 1, removedCount: 1, invalidCount: 0, rowCount: 2 })
    expect(result.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        row: null,
        inventoryId: 'inventory-b',
        sku: 'SKU-B',
        beforeQuantity: 5,
        afterQuantity: 0,
        status: 'removed',
      }),
    ]))
  })

  it('does not remove an omitted identity in another warehouse from a default-China snapshot', () => {
    const result = preview([
      row({ onHandQuantity: 10, productName: '기존 상품명' }),
    ], [
      inventory(),
      inventory({
        id: 'other-warehouse',
        warehouseCode: '광저우창고',
        sku: 'SKU-B',
        productName: '다른 창고 재고',
        onHandQuantity: 5,
        reservedQuantity: 0,
        availableQuantity: 5,
      }),
    ], new Map(), {
      fullSnapshot: true,
      snapshotWarehouseCodes: ['중국창고'],
    })

    expect(result.summary.removedCount).toBe(0)
    expect(result.rows).not.toEqual(expect.arrayContaining([expect.objectContaining({ sku: 'SKU-B' })]))
  })

  it.each([
    ['reservation', inventory({ id: 'reserved-row', sku: 'SKU-B', onHandQuantity: 5, reservedQuantity: 2, availableQuantity: 3 }), new Map<string, number>(), '출고 예약 2개를 먼저 처리해주세요.'],
    ['linked purchase', inventory({ id: 'linked-row', sku: 'SKU-B', onHandQuantity: 5, reservedQuantity: 0, availableQuantity: 5 }), new Map<string, number>([['linked-row', 3]]), '발주 연동 재고 3개를 먼저 처리해주세요.'],
  ])('blocks the complete snapshot when an omitted identity has an active %s obligation', (_kind, omitted, linked, expectedMessage) => {
    const result = preview([
      row({ onHandQuantity: 10, productName: '기존 상품명' }),
    ], [inventory(), omitted], linked, {
      fullSnapshot: true,
      snapshotWarehouseCodes: ['중국창고'],
    })

    expect(result.summary.invalidCount).toBe(1)
    expect(result.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: null, sku: 'SKU-B', status: 'protected', message: expect.stringContaining(expectedMessage) }),
    ]))
  })

  it('keeps an explicit zero row active in a full snapshot and restores an archived identity', () => {
    const result = preview([
      row({ onHandQuantity: 0, reportBlankQuantity: true }),
      row({ rowNumber: 3, sku: 'NEW-ZERO', productName: '신규 0 재고', onHandQuantity: 0, reportBlankQuantity: true }),
    ], [inventory({ reservedQuantity: 0, availableQuantity: 10, archivedAt: new Date('2026-10-20T00:00:00.000Z') })], new Map(), {
      fullSnapshot: true,
      snapshotWarehouseCodes: ['중국창고'],
    })

    expect(result.summary).toEqual({ newCount: 1, changedCount: 1, unchangedCount: 0, removedCount: 0, invalidCount: 0, rowCount: 2 })
    expect(result.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 2, status: 'changed', afterQuantity: 0, message: '재고현황 파일에 포함되어 목록에 다시 표시합니다.' }),
      expect.objectContaining({ row: 3, status: 'new', afterQuantity: 0 }),
    ]))
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

    expect(result.summary).toEqual({ newCount: 0, changedCount: 0, unchangedCount: 0, removedCount: 0, invalidCount: 1, rowCount: 1 })
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

    expect(result.summary).toEqual({ newCount: 0, changedCount: 0, unchangedCount: 0, removedCount: 0, invalidCount: 1, rowCount: 1 })
    expect(result.rows[0]).toEqual(expect.objectContaining({
      status: 'invalid',
      message: '엑셀의 SaaS재고ID를 현재 목록에서 찾을 수 없습니다.',
    }))
  })
})
