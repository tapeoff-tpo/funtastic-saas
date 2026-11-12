import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const mocks = vi.hoisted(() => ({ select: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: mocks }))
import { getPurchasingItemLabelDataBySku } from './items'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.select.mockReturnValue({ from: () => ({ where: async () => [
    { internalSku: 'legacy', metadata: { esa009m: { '중국어 상품명': '旧名称', '한국창고기준 위치': 'A' } } },
    { internalSku: 'cleared', metadata: { chineseProductName: null, esa009m: { '중국어 상품명': '旧名称' } } },
    { internalSku: 'confirmed', metadata: { chineseProductName: '新名称', esa009m: { '중국어 상품명': '旧名称' } } },
  ] }) })
})
describe('compact shipment label metadata', () => {
  it('preserves legacy names, explicit deletion and confirmed names when loading only label fields', async () => {
    const labels = await getPurchasingItemLabelDataBySku('owner', ['legacy', 'cleared', 'confirmed'])
    expect(labels.get('legacy')).toEqual({ chineseProductName: '旧名称', location: 'A' })
    expect(labels.get('cleared')?.chineseProductName).toBe('')
    expect(labels.get('confirmed')?.chineseProductName).toBe('新名称')
    const query = new PgDialect().sqlToQuery(mocks.select.mock.calls[0][0].metadata as SQL)
    expect(query.sql).toContain("? 'chineseProductName'")
    expect(query.sql).toContain("->'한국창고기준 위치'")
    expect(query.sql).not.toContain('optionDetails')
  })
})
