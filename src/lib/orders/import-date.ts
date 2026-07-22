const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30)
const DAY_MS = 24 * 60 * 60 * 1000
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

function dateFromKstParts(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - KST_OFFSET_MS)
}

function parseExcelSerialDate(value: number): Date | null {
  if (!Number.isFinite(value) || value < 1) return null

  const date = new Date(EXCEL_EPOCH_UTC + Math.round(value * DAY_MS))
  return dateFromKstParts(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  )
}

export function formatExcelDateCell(value: Date): string {
  const year = value.getUTCFullYear()
  const month = String(value.getUTCMonth() + 1).padStart(2, '0')
  const day = String(value.getUTCDate()).padStart(2, '0')
  const hour = String(value.getUTCHours()).padStart(2, '0')
  const minute = String(value.getUTCMinutes()).padStart(2, '0')
  const second = String(value.getUTCSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`
}

export function parseImportedOrderedAt(value: string): Date {
  const trimmed = value.trim()
  if (!trimmed) return new Date()

  const compactDateMatch = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (compactDateMatch) {
    return dateFromKstParts(
      Number(compactDateMatch[1]),
      Number(compactDateMatch[2]),
      Number(compactDateMatch[3]),
    )
  }

  const kstTextMatch = trimmed.match(
    /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/,
  )
  if (kstTextMatch) {
    return dateFromKstParts(
      Number(kstTextMatch[1]),
      Number(kstTextMatch[2]),
      Number(kstTextMatch[3]),
      Number(kstTextMatch[4] ?? 0),
      Number(kstTextMatch[5] ?? 0),
      Number(kstTextMatch[6] ?? 0),
    )
  }

  const serial = Number(trimmed)
  const serialDate = parseExcelSerialDate(serial)
  if (serialDate) return serialDate

  const parsed = new Date(trimmed)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}
