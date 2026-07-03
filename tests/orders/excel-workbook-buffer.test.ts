import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { normalizeExcelWorkbookBuffer } from '@/lib/orders/excel-workbook-buffer'

function createWorkbookBuffer(bookType: 'xls' | 'xlsx') {
  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['주문번호', '상품명'],
    ['ORDER-1', '테스트 상품'],
  ])
  XLSX.utils.book_append_sheet(workbook, worksheet, '주문')
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType }))
}

describe('normalizeExcelWorkbookBuffer', () => {
  it('keeps a real xlsx workbook unchanged', () => {
    const input = createWorkbookBuffer('xlsx')

    expect(normalizeExcelWorkbookBuffer(input)).toBe(input)
  })

  it('converts a legacy xls workbook even when the uploaded filename says xlsx', () => {
    const input = createWorkbookBuffer('xls')

    const normalized = normalizeExcelWorkbookBuffer(input)
    const workbook = XLSX.read(normalized, { type: 'buffer' })
    const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[workbook.SheetNames[0]], {
      header: 1,
    })

    expect(normalized.subarray(0, 2).toString()).toBe('PK')
    expect(rows[1]).toEqual(['ORDER-1', '테스트 상품'])
  })

  it('rejects content that is not an Excel workbook with a useful message', () => {
    expect(() => normalizeExcelWorkbookBuffer(Buffer.from('<!doctype html>error')))
      .toThrow('올바른 Excel 파일이 아닙니다')
  })

  it('explains how to upload an encrypted Excel workbook', () => {
    const container = XLSX.CFB.utils.cfb_new()
    XLSX.CFB.utils.cfb_add(container, 'EncryptedPackage', Buffer.from('encrypted'))
    XLSX.CFB.utils.cfb_add(container, 'EncryptionInfo', Buffer.from('info'))
    const input = Buffer.from(XLSX.CFB.write(container, { type: 'buffer' }))

    expect(() => normalizeExcelWorkbookBuffer(input))
      .toThrow('암호로 보호된 Excel 파일입니다')
  })
})
