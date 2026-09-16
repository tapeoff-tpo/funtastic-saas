import { describe, expect, it } from 'vitest'
import {
  chinaFundStatementAmountToInternalBalanceChange,
  chinaFundStatementDirection,
  extractChinaFundStatementTextFromOcr,
  parseChinaFundStatementText,
  summarizeChinaFundStatement,
} from './china-fund-statement-input'

const FULL_STATEMENT = [
  '날짜（日₋期）\t금액（充值金额）￥\t총합 ￥',
  '2026. 08. 28\t30000\t30000',
  '2026. 08. 31\t30000\t60000',
  '2026. 08. 31\t50000\t110000',
  '2026. 09. 01\t-95386.34\t14613.66',
  '2026. 09. 02\t30000\t44613.66',
  '2026. 09. 07\t50000\t94613.66',
  '2026. 09. 08\t30000\t124613.66',
  '2026. 09. 08\t-117896.94\t6716.72',
  '2026. 09. 08\t30000\t36716.72',
  '2026. 09. 10\t30000\t66716.72',
  '2026. 09. 14\t30000\t96716.72',
  '2026. 09. 14\t-98151.9\t-1435.18',
  '2026. 09. 14\t1435.18\t0',
].join('\n')

describe('parseChinaFundStatementText', () => {
  it('parses the provided 13-row China-side statement and verifies its totals', () => {
    const result = parseChinaFundStatementText(FULL_STATEMENT)

    expect(result.errors).toEqual([])
    expect(result.entries).toHaveLength(13)
    expect(result.inferredOpeningBalanceCny).toBe(0)
    expect(result.entries[0]).toEqual({
      occurredOn: '2026-08-28',
      signedAmountCny: 30_000,
      balanceAfterCny: 30_000,
    })
    expect(result.entries.at(-1)).toEqual({
      occurredOn: '2026-09-14',
      signedAmountCny: 1_435.18,
      balanceAfterCny: 0,
    })
    expect(result).toMatchObject({
      advanceTotalCny: 311_435.18,
      remittanceTotalCny: 311_435.18,
      finalBalanceCny: 0,
    })
    expect(summarizeChinaFundStatement(result.entries)).toEqual({
      chinaAdvanceCny: 311_435.18,
      companyRemittanceCny: 311_435.18,
      netChangeCny: 0,
      finalBalanceCny: 0,
    })
  })

  it('accepts hyphenated dates, currency marks, commas, and Unicode signs', () => {
    const result = parseChinaFundStatementText([
      '날짜\t금액\t총합',
      '2026-08-28\t＋￥30,000.00\t30,000',
      '2026-08-29\t− 1,234.50 元\t28,765.50',
    ].join('\n'))

    expect(result.errors).toEqual([])
    expect(result.entries).toEqual([
      { occurredOn: '2026-08-28', signedAmountCny: 30_000, balanceAfterCny: 30_000 },
      { occurredOn: '2026-08-29', signedAmountCny: -1_234.5, balanceAfterCny: 28_765.5 },
    ])
  })

  it('extracts the three statement columns from a descending OCR screenshot', () => {
    const extracted = extractChinaFundStatementTextFromOcr([
      '날짜 구분 중국 기준 금액 거래 후 총합 출처',
      '2026-09-14 중국 선결제 +1,435.18 元 0 元 중국 입금표 2026-08-28~2026-09-14',
      '2026-09-14 우리 입금 -98,151.9 元 -1,435.18 元 중국 입금표 2026-08-28~2026-09-14',
      '2026-09-14 중국 선결제 +30,000 元 96,716.72 元 중국 입금표 2026-08-28~2026-09-14',
      '2026-09-10 중국 선결제 +30,000 元 66,716.72 元 중국 입금표 2026-08-28~2026-09-14',
    ].join('\n'))

    expect(extracted).toMatchObject({ recognizedCount: 4, ignoredLineCount: 1 })
    expect(parseChinaFundStatementText(extracted.text)).toMatchObject({
      errors: [],
      entries: [
        { occurredOn: '2026-09-10', signedAmountCny: 30_000, balanceAfterCny: 66_716.72 },
        { occurredOn: '2026-09-14', signedAmountCny: 30_000, balanceAfterCny: 96_716.72 },
        { occurredOn: '2026-09-14', signedAmountCny: -98_151.9, balanceAfterCny: -1_435.18 },
        { occurredOn: '2026-09-14', signedAmountCny: 1_435.18, balanceAfterCny: 0 },
      ],
    })
  })

  it('uses the running balance to reverse same-day OCR rows shown newest first', () => {
    const extracted = extractChinaFundStatementTextFromOcr([
      '2026-09-14 중국 선결제 +1,435.18 元 0 元',
      '2026-09-14 우리 입금 -98,151.9 元 -1,435.18 元',
      '2026-09-14 중국 선결제 +30,000 元 96,716.72 元',
    ].join('\n'))

    expect(parseChinaFundStatementText(extracted.text)).toMatchObject({
      errors: [],
      entries: [
        { occurredOn: '2026-09-14', signedAmountCny: 30_000, balanceAfterCny: 96_716.72 },
        { occurredOn: '2026-09-14', signedAmountCny: -98_151.9, balanceAfterCny: -1_435.18 },
        { occurredOn: '2026-09-14', signedAmountCny: 1_435.18, balanceAfterCny: 0 },
      ],
    })
  })

  it('reports syntax and continuity errors with their original line numbers', () => {
    const result = parseChinaFundStatementText([
      '날짜\t금액\t총합',
      '2026-02-30\t100\t100',
      '2026-03-01\t금액없음\t100',
      '2026-03-02\t100',
      '2026-03-03\t100\t100',
      '2026-03-04\t50\t151',
    ].join('\n'))

    expect(result.entries).toEqual([
      { occurredOn: '2026-03-03', signedAmountCny: 100, balanceAfterCny: 100 },
      { occurredOn: '2026-03-04', signedAmountCny: 50, balanceAfterCny: 151 },
    ])
    expect(result.errors.map(({ lineNumber, code }) => ({ lineNumber, code }))).toEqual([
      { lineNumber: 2, code: 'invalid_date' },
      { lineNumber: 3, code: 'invalid_amount' },
      { lineNumber: 4, code: 'column_count' },
      { lineNumber: 6, code: 'balance_discontinuity' },
    ])
  })

  it('allows a 0.01 rounding difference but rejects a larger difference', () => {
    const result = parseChinaFundStatementText([
      '2026-09-01\t100\t100',
      '2026-09-02\t50\t150.01',
      '2026-09-03\t50\t200.03',
    ].join('\n'))

    expect(result.errors.map(({ lineNumber, code }) => ({ lineNumber, code }))).toEqual([
      { lineNumber: 3, code: 'balance_discontinuity' },
    ])
  })

  it('rejects zero-value transactions and rows pasted out of date order', () => {
    const result = parseChinaFundStatementText([
      '2026-09-02\t100\t100',
      '2026-09-01\t-50\t50',
      '2026-09-03\t0\t50',
    ].join('\n'))

    expect(result.errors.map(({ lineNumber, code }) => ({ lineNumber, code }))).toEqual([
      { lineNumber: 3, code: 'invalid_amount' },
      { lineNumber: 2, code: 'date_order' },
    ])
  })
})

describe('China-side sign helpers', () => {
  it('maps positive advances and negative company remittances to the internal sign', () => {
    expect(chinaFundStatementDirection(30_000)).toBe('china_advance')
    expect(chinaFundStatementDirection(-95_386.34)).toBe('company_remittance')
    expect(chinaFundStatementDirection(0)).toBe('settled')
    expect(chinaFundStatementAmountToInternalBalanceChange(30_000)).toBe(-30_000)
    expect(chinaFundStatementAmountToInternalBalanceChange(-95_386.34)).toBe(95_386.34)
  })
})
