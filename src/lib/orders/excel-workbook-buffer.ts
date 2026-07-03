import * as XLSX from 'xlsx'

const XLSX_SIGNATURE = Buffer.from([0x50, 0x4b])
const XLS_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

export class InvalidExcelWorkbookError extends Error {
  constructor(message = '올바른 Excel 파일이 아닙니다. Excel에서 파일을 열어 .xlsx 형식으로 다시 저장한 뒤 업로드해주세요.') {
    super(message)
    this.name = 'InvalidExcelWorkbookError'
  }
}

export function normalizeExcelWorkbookBuffer(buffer: Buffer): Buffer {
  if (buffer.subarray(0, XLSX_SIGNATURE.length).equals(XLSX_SIGNATURE)) {
    return buffer
  }

  if (!buffer.subarray(0, XLS_SIGNATURE.length).equals(XLS_SIGNATURE)) {
    throw new InvalidExcelWorkbookError()
  }

  try {
    const container = XLSX.CFB.read(buffer, { type: 'buffer' })
    if (container.FullPaths.some((path) => path.endsWith('/EncryptedPackage'))) {
      throw new InvalidExcelWorkbookError(
        '암호로 보호된 Excel 파일입니다. Excel에서 파일을 연 뒤 암호 보호를 해제하여 .xlsx로 다시 저장하고 업로드해주세요.',
      )
    }
  } catch (error) {
    if (error instanceof InvalidExcelWorkbookError) throw error
  }

  try {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
    if (workbook.SheetNames.length === 0) throw new Error('Workbook has no worksheets')
    return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
  } catch {
    throw new InvalidExcelWorkbookError('구형 Excel 파일을 읽을 수 없습니다. Excel에서 파일을 열어 .xlsx 형식으로 다시 저장한 뒤 업로드해주세요.')
  }
}
