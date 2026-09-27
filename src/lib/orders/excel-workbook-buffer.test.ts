import { beforeAll, describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import officeCrypto from 'officecrypto-tool'
import {
  ExcelWorkbookPasswordInvalidError,
  ExcelWorkbookPasswordRequiredError,
  normalizePasswordProtectedExcelWorkbookBuffer,
} from './excel-workbook-buffer'

describe('normalizePasswordProtectedExcelWorkbookBuffer', () => {
  const password = 'outbound-file-password'
  let encryptedWorkbook: Buffer

  beforeAll(() => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['주문번호', '수량'],
      ['ORDER-1', 3],
    ]), '출고반영')
    const plainWorkbook = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
    encryptedWorkbook = officeCrypto.encrypt(plainWorkbook, { password })
  })

  it('asks for a password before parsing an encrypted workbook', async () => {
    await expect(normalizePasswordProtectedExcelWorkbookBuffer(encryptedWorkbook)).rejects.toBeInstanceOf(ExcelWorkbookPasswordRequiredError)
  })

  it('decrypts an encrypted workbook with the current upload password', async () => {
    const normalized = await normalizePasswordProtectedExcelWorkbookBuffer(encryptedWorkbook, password)
    const workbook = XLSX.read(normalized, { type: 'buffer' })

    expect(workbook.Sheets['출고반영'].A2.v).toBe('ORDER-1')
  })

  it('rejects an incorrect password', async () => {
    await expect(normalizePasswordProtectedExcelWorkbookBuffer(encryptedWorkbook, 'incorrect-password')).rejects.toBeInstanceOf(ExcelWorkbookPasswordInvalidError)
  })
})
