import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import {
  createSabangnetWorkbook,
  sabangnetFilename,
  sabangnetOrderNumberForSale,
  sabangnetRowsFromSale,
  sabangnetValidationIssues,
} from './sabangnet-export'

const generatedAt = new Date('2026-11-13T12:00:00+09:00')

const sale = {
  clientName: '판타스틱 주식회사',
  recipientName: '홍길동',
  address: '인천광역시 서구 테스트로 1',
  recipientPhone: '010-1234-5678',
  deliveryMessage: '문 앞에 놓아주세요',
  items: [
    { productCode: 'SKU-1', name: '테스트 상품', spec: 'EA', qty: '2' },
    { productCode: 'SKU-2', name: '두번째 상품', spec: '화이트', qty: 3 },
  ],
}

describe('SabangNet registration export', () => {
  it('validates the exact required shipping fields', () => {
    expect(sabangnetValidationIssues({ items: [{ name: '', qty: 0 }] })).toEqual([
      '수취인명', '주소', '전화번호', '품명', '수량',
    ])
  })

  it('uses the generation date in the operational order number and filename', () => {
    expect(sabangnetOrderNumberForSale(sale, generatedAt)).toBe('20261113-bob1')
    expect(sabangnetFilename(sale, generatedAt)).toBe('사방넷_등록양식_20261113-bob1.xlsx')
  })

  it('maps every saved sale line to the nine-column registration format', () => {
    expect(sabangnetRowsFromSale(sale, generatedAt)).toEqual([
      expect.objectContaining({
        '주문번호': '20261113-bob1', '수취인명': '홍길동', '상품명': '테스트 상품',
        '옵션': '', '수량': 2, '상품코드(상품명)': '테스트 상품',
      }),
      expect.objectContaining({ '옵션': '화이트', '수량': 3 }),
    ])
  })

  it('creates a valid XLSX sheet with stable headers and typed quantities', () => {
    const buffer = createSabangnetWorkbook(sale, generatedAt)
    const workbook = XLSX.read(buffer, { type: 'array' })
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Sheet1!, { header: 1, raw: true })

    expect(rows[0]).toEqual([
      '주문번호', '수취인명', '주소', '전화번호', '배송메세지', '상품명', '옵션', '수량', '상품코드(상품명)',
    ])
    expect(rows[1]).toEqual([
      '20261113-bob1', '홍길동', '인천광역시 서구 테스트로 1', '010-1234-5678', '문 앞에 놓아주세요',
      '테스트 상품', '', 2, '테스트 상품',
    ])
  })

  it('rejects a workbook with missing operational data', () => {
    expect(() => createSabangnetWorkbook({ clientName: '거래처', items: [{ name: '상품', qty: 1 }] }, generatedAt))
      .toThrow('주소, 전화번호')
  })
})
