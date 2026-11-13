import ExcelJS from 'exceljs'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolvePurchaseSourceWarehouses, type PurchaseSourceWarehouseItem } from './purchase-source-warehouse'

const mocks = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: { execute: mocks.execute } }))

type FileKind = 'purchaseRequest' | 'purchasePlan' | 'purchaseHistory'
type File = { kind: FileKind; fileName: string; updatedAt: string; fileData: Uint8Array }
const headers: Record<FileKind, string[]> = {
  purchaseRequest: ['일자-No.', '품목코드', '창고명', '구입관리코드', '진행상태', '사전포장여부코드', '주문서번호'],
  purchasePlan: ['일자-No.', '품목코드', '입고창고명', '구입관리코드', '현재상태', '실 구매 수량(C)', '주문서번호 (C)'],
  purchaseHistory: ['일자-No.', '품목코드', '창고명', '구입관리코드', '진행상태', '발주서-no', '발주계획일자', '주문서번호 (C)'],
}
let revision = 0
const owner = () => `warehouse-owner-${revision}`
const item = (id: string, patch: Partial<PurchaseSourceWarehouseItem> = {}): PurchaseSourceWarehouseItem => ({
  id, status: 'purchase_completed', sku: 'SKU-01', purchaseManagementCode: 'M-01', supplierOrderNumber: null, rawData: {}, ...patch,
})
async function file(kind: FileKind, rows: Array<Record<string, string>>, updatedAt = String(revision)): Promise<File> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('원본')
  sheet.addRow(['Ecount original report'])
  sheet.addRow(headers[kind])
  for (const row of rows) sheet.addRow(headers[kind].map((header) => row[header] ?? ''))
  const bytes = await workbook.xlsx.writeBuffer()
  return { kind, fileName: `${kind}.xlsx`, updatedAt, fileData: Uint8Array.from(bytes as unknown as Uint8Array) }
}
function records(files: File[]) {
  mocks.execute.mockImplementation(async (query) => {
    const statement = new PgDialect().sqlToQuery(query).sql
    return files.map((entry) => statement.includes('file_data') ? entry : { ...entry, fileData: undefined })
  })
}
const row = (warehouse: string, patch: Record<string, string> = {}) => ({
  '일자-No.': '20261101-1', '품목코드': 'SKU-01', '구입관리코드': 'M-01', '입고창고명': warehouse, '창고명': warehouse, ...patch,
})

describe('original purchase warehouse display fallback', () => {
  beforeEach(() => { revision += 1; vi.clearAllMocks() })

  it('uses the stage-appropriate original warehouse under the shared owner without mutating operational values', async () => {
    records([await file('purchaseRequest', [row('쿠팡')]), await file('purchasePlan', [row('대량창고')])])
    const items = [item('request', { status: 'purchased' }), item('complete'), item('inspection', { status: 'inspecting' })]
    const snapshot = structuredClone(items)
    const resolved = await resolvePurchaseSourceWarehouses(owner(), items)
    expect([...resolved]).toEqual([['request', '쿠팡'], ['complete', '대량창고'], ['inspection', '대량창고']])
    expect(items).toEqual(snapshot)
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0])
    expect(query.params).toEqual([owner()])
    expect(query.sql).toContain('SELECT')
    expect(mocks.execute).toHaveBeenCalledTimes(2)
  })

  it('does not query or override manual/stored warehouses or guess from only a SKU or a reused payment note', async () => {
    const result = await resolvePurchaseSourceWarehouses(owner(), [
      item('manual', { rawData: { arrivalWarehouseCode: '중국창고', saasChinaMode: false } }),
      item('stored', { inboundWarehouseCode: '쿠팡' }),
      item('sku-only', { purchaseManagementCode: null }),
      item('payment-note', { purchaseManagementCode: null, supplierOrderNumber: '웨이신' }),
    ])
    expect(result.size).toBe(0)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('separates management keys for one SKU and leaves conflicting preferred-stage warehouse rows unresolved', async () => {
    records([await file('purchasePlan', [row('중국창고'), row('대량창고', { '구입관리코드': 'M-02' }), row('쿠팡', { '구입관리코드': 'CONFLICT' }), row('중국창고', { '구입관리코드': 'CONFLICT' })]),
      await file('purchaseRequest', [row('대량창고', { '구입관리코드': 'CONFLICT' })])])
    expect([...await resolvePurchaseSourceWarehouses(owner(), [item('one'), item('two', { purchaseManagementCode: 'M-02' }), item('conflict', { purchaseManagementCode: 'CONFLICT' })])])
      .toEqual([['one', '중국창고'], ['two', '대량창고']])
  })

  it('uses an exact numeric supplier order only when the management key is missing', async () => {
    records([await file('purchasePlan', [row('쿠팡', { '주문서번호 (C)': '3317159640039018761' })])])
    const resolved = await resolvePurchaseSourceWarehouses(owner(), [
      item('numeric', { purchaseManagementCode: null, supplierOrderNumber: '3317159640039018761' }),
      item('different-management', { purchaseManagementCode: 'M-OTHER', supplierOrderNumber: '3317159640039018761' }),
      item('different-sku', { sku: 'SKU-02', purchaseManagementCode: null, supplierOrderNumber: '3317159640039018761' }),
    ])
    expect([...resolved]).toEqual([['numeric', '쿠팡']])
  })

  it('disambiguates conflicting rows using the original report kind and document number rather than a mutable row number', async () => {
    records([await file('purchasePlan', [row('중국창고'), row('쿠팡', { '일자-No.': '20261102-1' })])])
    const result = await resolvePurchaseSourceWarehouses(owner(), [
      item('exact', { rawData: { source: 'ecount_purchasing_snapshot_plan_purchase_completed', sourceDateNo: '20261102-1', sourceRowNumber: 999 } }),
      item('row-number', { rawData: { sourceRowNumber: 4 } }),
    ])
    expect([...result]).toEqual([['exact', '쿠팡']])
  })

  it('reuses parsed file revisions, invalidates on upload changes, and isolates another owner', async () => {
    const files = [await file('purchasePlan', [row('중국창고')], 'revision-one')]
    records(files)
    expect((await resolvePurchaseSourceWarehouses(owner(), [item('one')])).get('one')).toBe('중국창고')
    expect(mocks.execute).toHaveBeenCalledTimes(2)
    await resolvePurchaseSourceWarehouses(owner(), [item('one')])
    expect(mocks.execute).toHaveBeenCalledTimes(3)
    files[0] = await file('purchasePlan', [row('쿠팡')], 'revision-two')
    expect((await resolvePurchaseSourceWarehouses(owner(), [item('one')])).get('one')).toBe('쿠팡')
    expect(mocks.execute).toHaveBeenCalledTimes(5)
    await resolvePurchaseSourceWarehouses(`${owner()}-other`, [item('one')])
    expect(mocks.execute).toHaveBeenCalledTimes(7)
  })

  it('evicts a failed parse so the same revision can be retried after a transient load failure', async () => {
    const files = [await file('purchasePlan', [row('중국창고')])]
    const validData = files[0].fileData
    files[0].fileData = new Uint8Array([1, 2, 3])
    records(files)
    await expect(resolvePurchaseSourceWarehouses(owner(), [item('one')])).rejects.toThrow()
    files[0].fileData = validData
    expect((await resolvePurchaseSourceWarehouses(owner(), [item('one')])).get('one')).toBe('중국창고')
    expect(mocks.execute).toHaveBeenCalledTimes(4)
  })

  it('tolerates a workspace without preserved raw files while surfacing unrelated database failures', async () => {
    mocks.execute.mockRejectedValueOnce({ cause: { code: '42P01' } })
    expect((await resolvePurchaseSourceWarehouses(owner(), [item('one')])).size).toBe(0)
    mocks.execute.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(resolvePurchaseSourceWarehouses(owner(), [item('one')])).rejects.toThrow('database unavailable')
  })
})
