import * as XLSX from 'xlsx'

const STOCK_LIST_URL = 'https://docs.google.com/spreadsheets/d/1j5nkny_EUFZlZxRKGDd_myVsRL2DNyhNosQMgneESBs/export?format=csv&gid=30673467'

/** Read the supplier's live list. A failed fetch must never be treated as an empty list. */
export async function getShortMeetingStockList(): Promise<Map<string, string>> {
  const response = await fetch(STOCK_LIST_URL, { cache: 'no-store', signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new Error(`품절리스트 조회 실패 (${response.status})`)
  return parseShortMeetingStockList(await response.text())
}

export function parseShortMeetingStockList(csv: string): Map<string, string> {
  const workbook = XLSX.read(csv, { type: 'string', raw: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw new Error('품절리스트 시트가 비어 있습니다.')
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '', raw: true })
  const headerIndex = rows.findIndex((row) =>
    String(row[0]).trim() === '품절날짜' && String(row[4]).trim() === '상품코드2' && String(row[5]).trim() === '입고일정',
  )
  if (headerIndex < 0) throw new Error('품절리스트의 열 구성을 확인할 수 없습니다.')
  const result = new Map<string, string>()
  for (const row of rows.slice(headerIndex + 1)) {
    const sku = String(row[4] ?? '').trim()
    if (!sku) continue
    const details = [String(row[0] ?? '').trim(), String(row[5] ?? '').trim()].filter(Boolean).join(' ')
    const previous = result.get(sku)
    if (!previous) result.set(sku, details || '품절')
    else if (details && !previous.split(' / ').includes(details)) result.set(sku, `${previous} / ${details}`)
  }
  return result
}
