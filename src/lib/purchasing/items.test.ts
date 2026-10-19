import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import {
  ESA009M_HEADERS,
  ensurePurchasingItemIdentity,
  getOutgoingMetricWindows,
  PURCHASE_URL_HEADER,
  parseAverageSalesWorkbook,
  parseEsa009mWorkbook,
  purchaseUrlExportStatus,
  purchaseUrlVerification,
  resolveOutgoingMetrics,
} from './items'
import type { Esa009mData } from './items'

describe('parseEsa009mWorkbook', () => {
  it('includes product-information fields in the item schema', () => {
    expect(ESA009M_HEADERS).toEqual(expect.arrayContaining([
      '재질',
      '제품크기',
      '제조사',
      '무게',
      '제조국',
      '용량',
      '[식약처]유리/도자기제품 필수확인',
      '구성품',
      '특이사항',
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

describe('parseAverageSalesWorkbook', () => {
  it('uses the three completed months before the latest workbook month', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('평균판매')
    sheet.addRow([
      '사방넷상품코드\n[수정불가]',
      '상품약어\n[수정불가]',
      '옵션상세명칭',
      '1달 평균판매',
      '3개월판매',
      new Date('2026-10-01T00:00:00.000Z'),
      new Date('2026-09-01T00:00:00.000Z'),
      new Date('2026-08-01T00:00:00.000Z'),
      new Date('2026-07-01T00:00:00.000Z'),
    ])
    sheet.addRow(['A001', '상품', '옵션', 20, 60, 11, 30, 20, 10])
    const buffer = await workbook.xlsx.writeBuffer()

    const result = await parseAverageSalesWorkbook(buffer as ArrayBuffer)

    expect(result.referenceMonth).toBe('2026-10')
    expect(result.completedMonths).toEqual(['2026-07', '2026-08', '2026-09'])
    expect(result.rows).toEqual([{
      internalSku: 'A001',
      currentMonthWorkbookOutgoing: 11,
      completedMonthOutgoing: {
        '2026-07': 10,
        '2026-08': 20,
        '2026-09': 30,
      },
      threeMonthSales: 60,
      threeMonthAverageOutgoing: 20,
    }])
  })

  it('rejects a row when the stored three-month total does not match its months', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('평균판매')
    sheet.addRow([
      '사방넷상품코드',
      '3개월판매',
      new Date('2026-10-01T00:00:00.000Z'),
      new Date('2026-09-01T00:00:00.000Z'),
      new Date('2026-08-01T00:00:00.000Z'),
      new Date('2026-07-01T00:00:00.000Z'),
    ])
    sheet.addRow(['A001', 99, 3, 30, 20, 10])
    const buffer = await workbook.xlsx.writeBuffer()

    await expect(parseAverageSalesWorkbook(buffer as ArrayBuffer))
      .rejects.toThrow('3개월판매(99)가 직전 3개월 합계(60)와 다릅니다.')
  })
})

describe('ensurePurchasingItemIdentity', () => {
  it('keeps the existing product identity when a cost import initializes item metadata', () => {
    const itemData = Object.fromEntries(ESA009M_HEADERS.map((header) => [header, null])) as Esa009mData
    itemData['신규원가(元)'] = '16.51'

    const result = ensurePurchasingItemIdentity(itemData, {
      internalSku: '112456-0001',
      name: '카반 2단 더블 컵홀더',
    })

    expect(result).toMatchObject({
      '품목코드': '112456-0001',
      '품목명': '카반 2단 더블 컵홀더',
      '신규원가(元)': '16.51',
    })
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

  it('keeps current-month order concentration when applying a stored baseline', () => {
    const result = resolveOutgoingMetrics(
      {
        purchasingOutgoingMetrics: {
          threeMonthAverageOutgoing: 1.3,
        },
      },
      {
        currentMonthOutgoing: 101,
        threeMonthAverageOutgoing: 1.3,
        currentMonthOrderCount: 1,
        currentMonthLargestOrderQuantity: 101,
      },
    )

    expect(result).toEqual({
      currentMonthOutgoing: 101,
      threeMonthAverageOutgoing: 1.3,
      currentMonthOrderCount: 1,
      currentMonthLargestOrderQuantity: 101,
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

  it('keeps a saved M테이포프 bulk-average adjustment for purchase recommendation reasons', () => {
    const result = resolveOutgoingMetrics({
      purchasingOutgoingMetrics: {
        threeMonthAverageOutgoing: 39,
        specialBulkOutgoingAdjustment: {
          specialMall: 'M테이포프(대량)',
          policy: 'one_month_excluded_repeat_half',
          sourceMonths: ['26년8월', '26년7월', '26년6월'],
          rawThreeMonthAverageOutgoing: 139,
          specialBulkQuantity: 300,
          specialBulkMonthCount: 1,
          specialBulkIncludedQuantity: 0,
          specialBulkExcludedQuantity: 300,
          adjustedThreeMonthAverageOutgoing: 39,
        },
      },
    }, {
      currentMonthOutgoing: 44,
      threeMonthAverageOutgoing: 10,
    })

    expect(result).toMatchObject({
      currentMonthOutgoing: 44,
      threeMonthAverageOutgoing: 39,
      specialBulkOutgoingAdjustment: {
        specialMall: 'M테이포프(대량)',
        specialBulkQuantity: 300,
        specialBulkMonthCount: 1,
        specialBulkIncludedQuantity: 0,
      },
    })
  })

  it('uses the workbook baseline only during its reference month, then resumes live rolling data', () => {
    const metadata = {
      purchasingOutgoingMetrics: {
        threeMonthAverageOutgoing: 999,
      },
      purchasingRollingAverageBaseline: {
        referenceMonth: '2026-10',
        threeMonthAverageOutgoing: 12.3,
      },
    }
    const calculated = {
      currentMonthOutgoing: 8,
      threeMonthAverageOutgoing: 7.7,
    }

    expect(resolveOutgoingMetrics(metadata, calculated, '2026-10')).toEqual({
      currentMonthOutgoing: 8,
      threeMonthAverageOutgoing: 12.3,
    })
    expect(resolveOutgoingMetrics(metadata, calculated, '2026-11')).toEqual(calculated)
  })

  it('keeps the latest two completed months for sustained-demand review', () => {
    const result = resolveOutgoingMetrics({
      purchasingRollingAverageBaseline: {
        referenceMonth: '2026-10',
        completedMonthOutgoing: {
          '2026-07': 3,
          '2026-08': 20,
          '2026-09': 20,
        },
        threeMonthSales: 43,
        threeMonthAverageOutgoing: 14.3,
      },
    }, {
      currentMonthOutgoing: 20,
      threeMonthAverageOutgoing: 0,
    }, '2026-10')

    expect(result).toMatchObject({
      currentMonthOutgoing: 20,
      threeMonthAverageOutgoing: 14.3,
      recentCompletedMonthOutgoing: [20, 20],
    })
  })

  it('keeps a one-off M테이포프 bulk order out of the current workbook baseline', () => {
    const result = resolveOutgoingMetrics({
      purchasingOutgoingMetrics: {
        specialBulkOutgoingAdjustment: {
          specialMall: 'M테이포프(대량)',
          policy: 'one_month_excluded_repeat_half',
          sourceMonths: ['26년9월', '26년8월', '26년7월'],
          rawThreeMonthAverageOutgoing: 21.3,
          specialBulkQuantity: 900,
          specialBulkMonthCount: 1,
          specialBulkIncludedQuantity: 0,
          specialBulkExcludedQuantity: 900,
          adjustedThreeMonthAverageOutgoing: 0,
        },
      },
      purchasingRollingAverageBaseline: {
        referenceMonth: '2026-10',
        completedMonthOutgoing: {
          '2026-07': 27,
          '2026-08': 19,
          '2026-09': 912,
        },
        threeMonthSales: 958,
        threeMonthAverageOutgoing: 319.3,
      },
    }, {
      currentMonthOutgoing: 2,
      threeMonthAverageOutgoing: 0,
    }, '2026-10')

    expect(result).toMatchObject({
      currentMonthOutgoing: 2,
      threeMonthAverageOutgoing: 19.3,
      specialBulkOutgoingAdjustment: {
        specialBulkExcludedQuantity: 900,
        adjustedThreeMonthAverageOutgoing: 19.3,
      },
    })
  })
})

describe('getOutgoingMetricWindows', () => {
  it('uses Seoul month boundaries before 09:00 KST', () => {
    const result = getOutgoingMetricWindows(new Date('2026-07-31T15:30:00.000Z'))

    expect(result.currentMonthDate).toBe('2026-08-01')
    expect(result.twoMonthsAgoDate).toBe('2026-06-01')
    expect(result.previousMonthDate).toBe('2026-07-01')
    expect(result.nextMonthDate).toBe('2026-09-01')
    expect(result.currentMonthStart.toISOString()).toBe('2026-07-31T15:00:00.000Z')
    expect(result.nextMonthStart.toISOString()).toBe('2026-08-31T15:00:00.000Z')
  })
})
