import * as XLSX from 'xlsx'
import officeCrypto from 'officecrypto-tool'

const XLSX_SIGNATURE = Buffer.from([0x50, 0x4b])
const XLS_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

export class InvalidExcelWorkbookError extends Error {
  constructor(message = '올바른 Excel 파일이 아닙니다. Excel에서 파일을 열어 .xlsx 형식으로 다시 저장한 뒤 업로드해주세요.') {
    super(message)
    this.name = 'InvalidExcelWorkbookError'
  }
}

/** Raised when an Office-encrypted workbook needs its per-upload password. */
export class ExcelWorkbookPasswordRequiredError extends InvalidExcelWorkbookError {
  constructor() {
    super('파일이 비밀번호로 보호되어 있습니다. 파일의 비밀번호를 입력하여 주세요.')
    this.name = 'ExcelWorkbookPasswordRequiredError'
  }
}

/** Raised when the submitted password cannot open an Office-encrypted workbook. */
export class ExcelWorkbookPasswordInvalidError extends InvalidExcelWorkbookError {
  constructor() {
    super('파일 비밀번호가 올바르지 않습니다. 다시 입력하여 주세요.')
    this.name = 'ExcelWorkbookPasswordInvalidError'
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
    if (container.FullPaths.some((path: string) => path.endsWith('/EncryptedPackage'))) {
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

/**
 * Opens a password-protected Excel workbook for the outbound-reflection flow.
 *
 * This stays async and separate from `normalizeExcelWorkbookBuffer` because
 * Office decryption is async, while the existing import paths intentionally
 * retain their synchronous normalizer and continue rejecting encrypted files.
 * The password is supplied by the current request only and is never persisted.
 */
export async function normalizePasswordProtectedExcelWorkbookBuffer(buffer: Buffer, password?: string): Promise<Buffer> {
  if (!isPasswordProtectedExcelWorkbook(buffer)) return normalizeExcelWorkbookBuffer(buffer)

  if (password === undefined || password.length === 0) {
    throw new ExcelWorkbookPasswordRequiredError()
  }

  try {
    const decrypted = await officeCrypto.decrypt(buffer, { password })
    return normalizeExcelWorkbookBuffer(Buffer.from(decrypted))
  } catch (error) {
    if (error instanceof InvalidExcelWorkbookError) throw error
    throw new ExcelWorkbookPasswordInvalidError()
  }
}

function isPasswordProtectedExcelWorkbook(buffer: Buffer): boolean {
  if (!buffer.subarray(0, XLS_SIGNATURE.length).equals(XLS_SIGNATURE)) return false

  try {
    return officeCrypto.isEncrypted(buffer)
  } catch {
    // Preserve the existing, more helpful invalid-workbook message below.
    return false
  }
}
