import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import {
  ESA009M_HEADERS,
  getOutgoingMetricWindows,
  PURCHASE_URL_HEADER,
  parseEsa009mWorkbook,
  purchaseUrlExportStatus,
  purchaseUrlVerification,
  resolveOutgoingMetrics,
} from './items'

describe('parseEsa009mWorkbook', () => {
  it('includes product-information fields in the item schema', () => {
    expect(ESA009M_HEADERS).toEqual(expect.arrayContaining([
      '재질',
      '제품크기',
      '제조사',
      '무게',
      '제조국',
      '용량',
    ]))
  })

  it('preserves all ESA009M columns and skips rows without a code or name', async () => {
    const [codeHeader, nameHeader] = ESA009M_HEADERS
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('items')
    sheet.addRow([...ESA009M_HEADERS])
    sheet.addRow(ESA009M_HEADERS.map((header) => {
      if (header === codeHeader) return 'A001'
      if (header === nameHeader) return 'Test item'
      return `${header} value`
    }))
    sheet.addRow(['', '20260615 exported'])
    const buffer = await workbook.xlsx.writeBuffer()

    const result = await parseEsa009mWorkbook(buffer as ArrayBuffer)

    expect(result).toMatchObject({ total: 2, skipped: 1 })
    expect(result.rows).toHaveLength(1)
    expect(Object.keys(result.rows[0])).toEqual([...ESA009M_HEADERS])
    expect(result.rows[0][codeHeader]).toBe('A001')
    expect(result.rows[0][nameHeader]).toBe('Test item')
  })

  it('normalizes the legacy existing-price header to the special-price header', async () => {
    const legacyHeaders = ESA009M_HEADERS.map((header) => (
      String(header) === '특가(元)' ? '기존원가(元)' : header
    ))
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('items')
    sheet.addRow(legacyHeaders)
    sheet.addRow(legacyHeaders.map((header) => {
      if (header === '품목코드') return 'A001'
      if (header === '품목명') return 'Test item'
      if (header === '기존원가(元)') return '12.5'
      return `${header} value`
    }))
    const buffer = await workbook.xlsx.writeBuffer()

    const result = await parseEsa009mWorkbook(buffer as ArrayBuffer)
    const parsedRow = result.rows[0] as Record<string, string | null>

    expect(ESA009M_HEADERS).toContain('특가(元)')
    expect(ESA009M_HEADERS).not.toContain('기존원가(元)')
    expect(parsedRow['특가(元)']).toBe('12.5')
    expect(parsedRow['기존원가(元)']).toBeUndefined()
  })

  it('accepts older files without the purchase URL column', async () => {
    const [codeHeader, nameHeader] = ESA009M_HEADERS
    const headersWithoutPurchaseUrl = ESA009M_HEADERS.filter((header) => header !== PURCHASE_URL_HEADER)
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('items')
    sheet.addRow(headersWithoutPurchaseUrl)
    sheet.addRow(headersWithoutPurchaseUrl.map((header) => {
      if (header === codeHeader) return 'A001'
      if (header === nameHeader) return 'Test item'
      return `${header} value`
    }))
    const buffer = await workbook.xlsx.writeBuffer()

    const result = await parseEsa009mWorkbook(buffer as ArrayBuffer)

    expect(result.rows[0][PURCHASE_URL_HEADER]).toBeNull()
  })
})

describe('purchaseUrlExportStatus', () => {
  it('keeps URL verification status visible in Excel exports', () => {
    expect(purchaseUrlExportStatus({ [PURCHASE_URL_HEADER]: null }, 'confirm_required')).toBe('확인 필요')
    expect(purchaseUrlExportStatus({ [PURCHASE_URL_HEADER]: null }, null)).toBe('URL 없음')
    expect(purchaseUrlExportStatus({ [PURCHASE_URL_HEADER]: 'https://detail.1688.com/offer/123456.html' }, null)).toBe('등록됨')
  })
})

describe('purchaseUrlVerification', () => {
  it('returns the saved reason for the dedicated error export', () => {
    expect(purchaseUrlVerification({
      purchaseUrlVerification: {
        status: 'confirm_required',
        reason: '1688 페이지 응답 시간 초과',
        checkedAt: '2026-07-21T10:30:00.000Z',
      },
    })).toEqual({
      status: 'confirm_required',
      reason: '1688 페이지 응답 시간 초과',
      checkedAt: '2026-07-21T10:30:00.000Z',
    })
  })
})

describe('resolveOutgoingMetrics', () => {
  it('uses calculated current-month outgoing with the stored three-month baseline', () => {
    const result = resolveOutgoingMetrics(
      {
        purchasingOutgoingMetrics: {
          currentMonthOutgoing: 20,
          threeMonthAverageOutgoing: 12.3,
          source: 'monthly-sales-calculator',
          referenceMonth: '2026-06',
        },
      },
      {
        currentMonthOutgoing: 4,
        threeMonthAverageOutgoing: 5,
      },
    )

    expect(result).toEqual({
      currentMonthOutgoing: 4,
      threeMonthAverageOutgoing: 12.3,
    })
  })

  it('uses calculated metrics when stored values are invalid', () => {
    const calculated = {
      currentMonthOutgoing: 4,
      threeMonthAverageOutgoing: 5,
    }

    expect(resolveOutgoingMetrics({
      purchasingOutgoingMetrics: {
        currentMonthOutgoing: 20,
        threeMonthAverageOutgoing: -1,
      },
    }, calculated)).toEqual(calculated)
  })
})

describe('getOutgoingMetricWindows', () => {
  it('uses Seoul month boundaries before 09:00 KST', () => {
    const result = getOutgoingMetricWindows(new Date('2026-07-31T15:30:00.000Z'))

    expect(result.currentMonthDate).toBe('2026-08-01')
    expect(result.nextMonthDate).toBe('2026-09-01')
    expect(result.currentMonthStart.toISOString()).toBe('2026-07-31T15:00:00.000Z')
    expect(result.nextMonthStart.toISOString()).toBe('2026-08-31T15:00:00.000Z')
  })
})
