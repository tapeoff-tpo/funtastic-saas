import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import ExcelJS from 'exceljs'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { inventory } from '@/lib/db/schema'
import { inventoryMonthEndStock } from '@/lib/inventory/snapshot-schema'
import { getInventoryPeriod } from '@/lib/inventory/period'

const mocks = vi.hoisted(() => ({ select: vi.fn(), getUser: vi.fn(), owner: vi.fn(), from: vi.fn(), where: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: { select: mocks.select } }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }))
vi.mock('@/lib/admin-accounts/queries', () => ({ getWorkspaceUserId: mocks.owner }))
import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'staff' } } })
  mocks.owner.mockResolvedValue('workspace-owner')
  mocks.select.mockImplementation(() => {
    const chain = {
      from: (table: unknown) => { mocks.from(table); return chain },
      where: (condition: SQL) => { mocks.where(condition); return chain },
      innerJoin: () => chain, leftJoin: () => chain, groupBy: () => chain,
      orderBy: async () => [{ sku: 'SKU-1', productName: '상품', warehouseZone: '1창고', availableStock: 7, totalStock: 7, reservedStock: 0, monthlyIncoming: 2, monthlyOutgoing: 10 }],
    }
    return chain
  })
})

describe('inventory export period and workspace', () => {
  it('exports historical stock without using the live stock or staff account inventory', async () => {
    const response = await GET(new NextRequest('https://example.test/api/inventory/export?year=2026&month=10&skus=SKU-1'))
    expect(response.status).toBe(200)
    expect(mocks.from).toHaveBeenCalledWith(inventoryMonthEndStock)
    const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0])
    expect(query.params).toEqual(['workspace-owner', '2026-10', 'SKU-1'])
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()) as never)
    const sheet = workbook.worksheets[0]
    expect(sheet.getCell('H1').value).toBe('월말재고(가용)')
    expect(sheet.getCell('H2').value).toBe(7)
  })

  it('keeps the current month on live inventory under the canonical workspace', async () => {
    const period = getInventoryPeriod()
    await GET(new NextRequest(`https://example.test/api/inventory/export?year=${period.year}&month=${period.month}`))
    expect(mocks.from).toHaveBeenCalledWith(inventory)
    const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0])
    expect(query.params.filter((value) => value === 'workspace-owner')).toHaveLength(2)
    expect(query.params).not.toContain('staff')
  })
})
