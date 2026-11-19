import type { ShortMeetingRawData } from './short-meeting-upload-parser'

export type RawSort = number | 'row' | null
export type RawDirection = 'ascending' | 'descending'
export const RAW_PAGE_SIZE = 100
// Leave room for JSON and framework overhead in a serverless response.
const MAX_PAGE_BYTES = 2 * 1024 * 1024
const collator = new Intl.Collator('ko-KR', { numeric: true, sensitivity: 'base' })

export class RawPageTooLargeError extends Error {
  constructor() {
    super('원본의 한 행 또는 열 제목이 너무 커서 표시할 수 없습니다.')
  }
}

export function queryShortMeetingRawData(raw: ShortMeetingRawData, options: {
  search: string
  sort: RawSort
  direction: RawDirection
  page: number
}) {
  const search = options.search.trim().toLocaleLowerCase('ko-KR')
  const filtered = raw.rows.filter((row) => !search || row.cells.some((cell) => cell.toLocaleLowerCase('ko-KR').includes(search)))
  if (options.sort !== null) {
    const sort = options.sort
    filtered.sort((left, right) => {
      if (sort === 'row') return (left.rowNumber - right.rowNumber) * (options.direction === 'ascending' ? 1 : -1)
      return compareCells(left.cells[sort] ?? '', right.cells[sort] ?? '', options.direction)
    })
  }

  const headerBytes = Buffer.byteLength(JSON.stringify(raw.headers), 'utf8') + 4096
  if (headerBytes > MAX_PAGE_BYTES) throw new RawPageTooLargeError()
  const pages: typeof raw.rows[] = [[]]
  let pageBytes = headerBytes
  for (const row of filtered) {
    const bytes = Buffer.byteLength(JSON.stringify(row), 'utf8') + 1
    if (headerBytes + bytes > MAX_PAGE_BYTES) throw new RawPageTooLargeError()
    const current = pages[pages.length - 1]
    if (current.length >= RAW_PAGE_SIZE || pageBytes + bytes > MAX_PAGE_BYTES) {
      pages.push([])
      pageBytes = headerBytes
    }
    pages[pages.length - 1].push(row)
    pageBytes += bytes
  }
  const page = Math.min(Math.max(1, options.page), pages.length)
  return { rawAvailable: true, headers: raw.headers, rows: pages[page - 1], totalRows: raw.rows.length,
    filteredRows: filtered.length, page, pageSize: RAW_PAGE_SIZE, totalPages: pages.length }
}

function compareCells(left: string, right: string, direction: RawDirection): number {
  const a = left.trim()
  const b = right.trim()
  if (!a) return b ? 1 : 0
  if (!b) return -1
  const leftDate = dateValue(a)
  const rightDate = dateValue(b)
  const numberPattern = /^[-+]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/
  const leftNumber = numberPattern.test(a) ? Number(a.replace(/,/g, '')) : NaN
  const rightNumber = numberPattern.test(b) ? Number(b.replace(/,/g, '')) : NaN
  const numeric = Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
    && Math.abs(leftNumber) <= Number.MAX_SAFE_INTEGER && Math.abs(rightNumber) <= Number.MAX_SAFE_INTEGER
  const comparison = leftDate !== null && rightDate !== null ? leftDate - rightDate
    : numeric ? leftNumber - rightNumber : collator.compare(a, b)
  return direction === 'ascending' ? comparison : -comparison
}

/** Recognize common formatted Excel dates; do not invent values for invalid dates. */
function dateValue(value: string): number | null {
  const match = value.match(/^(?:(\d{4})[-./](\d{1,2})[-./](\d{1,2})|(\d{1,2})\/(\d{1,2})\/(\d{4})|(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일)(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (!match) return null
  const year = Number(match[1] ?? match[6] ?? match[7])
  const month = Number(match[2] ?? match[4] ?? match[8])
  const day = Number(match[3] ?? match[5] ?? match[9])
  const hours = Number(match[10] ?? 0), minutes = Number(match[11] ?? 0), seconds = Number(match[12] ?? 0)
  if (hours > 23 || minutes > 59 || seconds > 59) return null
  const date = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date.valueOf()
}
