import { describe, it, expect, vi, beforeEach } from 'vitest'
import ExcelJS from 'exceljs'

// Mock db for matchInvoicesToOrders
vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
  },
}))

import {
  parseInvoiceExcel,
  matchInvoicesToOrders,
} from '@/lib/shipping/excel/import'
import { db } from '@/lib/db'

async function createTestExcelBuffer(
  rows: Array<[string, string, string?]>,
  headers: [string, string, string?] = ['주문번호', '송장번호', '택배사'],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  ws.addRow(headers)
  for (const row of rows) {
    ws.addRow(row)
  }
  const arrayBuf = await wb.xlsx.writeBuffer()
  return Buffer.from(arrayBuf)
}

describe('parseInvoiceExcel', () => {
  it('reads an ExcelJS workbook buffer and extracts rows with trackingNumber + orderIdentifier', async () => {
    const buffer = await createTestExcelBuffer([
      ['ORDER-001', '1234567890', 'CJGLS'],
      ['ORDER-002', '9876543210', 'HANJIN'],
    ])

    const result = await parseInvoiceExcel(buffer)

    expect(result.valid).toHaveLength(2)
    expect(result.valid[0].orderIdentifier).toBe('ORDER-001')
    expect(result.valid[0].trackingNumber).toBe('1234567890')
    expect(result.valid[0].carrierId).toBe('CJGLS')
    expect(result.valid[1].orderIdentifier).toBe('ORDER-002')
    expect(result.valid[1].trackingNumber).toBe('9876543210')
  })

  it('validates rows with Zod and rejects rows missing trackingNumber', async () => {
    const buffer = await createTestExcelBuffer([
      ['ORDER-001', '1234567890', 'CJGLS'],
      ['ORDER-002', '', ''],  // missing tracking number
      ['', '5555555555', 'KGB'],  // missing order identifier
    ])

    const result = await parseInvoiceExcel(buffer)

    expect(result.valid).toHaveLength(1)
    expect(result.valid[0].orderIdentifier).toBe('ORDER-001')
    expect(result.invalid.length).toBeGreaterThanOrEqual(2)
    expect(result.invalid[0].row).toBeGreaterThan(1)
    expect(result.invalid[0].errors.length).toBeGreaterThan(0)
  })

  it('supports custom column mapping', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Sheet1')
    ws.addRow(['택배사', '주문번호', '송장번호'])
    ws.addRow(['CJGLS', 'ORDER-001', '1234567890'])
    const buffer = Buffer.from(await wb.xlsx.writeBuffer())

    const result = await parseInvoiceExcel(buffer, {
      orderIdCol: 2,
      trackingNumberCol: 3,
      carrierCol: 1,
    })

    expect(result.valid).toHaveLength(1)
    expect(result.valid[0].orderIdentifier).toBe('ORDER-001')
    expect(result.valid[0].trackingNumber).toBe('1234567890')
    expect(result.valid[0].carrierId).toBe('CJGLS')
  })
})

describe('matchInvoicesToOrders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('matches parsed rows to orders by marketplaceOrderId', async () => {
    const parsedRows = [
      { orderIdentifier: 'MKT-001', trackingNumber: '111', carrierId: 'CJGLS' },
      { orderIdentifier: 'MKT-002', trackingNumber: '222', carrierId: 'HANJIN' },
    ]

    const mockOrders = [
      { id: 'uuid-1', marketplaceOrderId: 'MKT-001', userId: 'user-1' },
      { id: 'uuid-2', marketplaceOrderId: 'MKT-002', userId: 'user-1' },
    ]

    const mockWhere = vi.fn().mockResolvedValue(mockOrders)
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
    ;(db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: mockFrom })

    const result = await matchInvoicesToOrders(parsedRows, 'user-1')

    expect(result.matched).toHaveLength(2)
    expect(result.matched[0].orderId).toBe('uuid-1')
    expect(result.matched[0].trackingNumber).toBe('111')
    expect(result.unmatched).toHaveLength(0)
  })

  it('matches one marketplace order invoice to every split internal order', async () => {
    const parsedRows = [
      { orderIdentifier: 'MKT-SPLIT', trackingNumber: '111', carrierId: 'CJGLS' },
    ]

    const mockOrders = [
      { id: 'uuid-1', marketplaceOrderId: 'MKT-SPLIT', internalNo: 'IN-1', userId: 'user-1' },
      { id: 'uuid-2', marketplaceOrderId: 'MKT-SPLIT', internalNo: 'IN-2', userId: 'user-1' },
      { id: 'uuid-3', marketplaceOrderId: 'MKT-SPLIT', internalNo: 'IN-3', userId: 'user-1' },
    ]

    const mockWhere = vi.fn().mockResolvedValue(mockOrders)
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
    ;(db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: mockFrom })

    const result = await matchInvoicesToOrders(parsedRows, 'user-1')

    expect(result.matched).toHaveLength(3)
    expect(result.matched.map((row) => row.orderId)).toEqual(['uuid-1', 'uuid-2', 'uuid-3'])
    expect(result.unmatched).toHaveLength(0)
  })

  it('returns unmatched rows separately', async () => {
    const parsedRows = [
      { orderIdentifier: 'MKT-001', trackingNumber: '111', carrierId: 'CJGLS' },
      { orderIdentifier: 'MKT-UNKNOWN', trackingNumber: '222', carrierId: 'HANJIN' },
    ]

    const mockOrders = [
      { id: 'uuid-1', marketplaceOrderId: 'MKT-001', userId: 'user-1' },
    ]

    const mockWhere = vi.fn().mockResolvedValue(mockOrders)
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
    ;(db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: mockFrom })

    const result = await matchInvoicesToOrders(parsedRows, 'user-1')

    expect(result.matched).toHaveLength(1)
    expect(result.unmatched).toHaveLength(1)
    expect(result.unmatched[0].orderIdentifier).toBe('MKT-UNKNOWN')
  })
})
