import ExcelJS from 'exceljs'
import { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { createClient } from '@/lib/supabase/server'
import {
  ESA009M_HEADERS,
  type Esa009mHeader,
  getAllPurchasingItems,
  purchaseUrlExportStatus,
} from '@/lib/purchasing/items'

const EXTRA_HEADERS = ['구매 URL 상태', '당월 출고수량', '3개월 평균 출고수량', '최근 반영일'] as const
type ExtraHeader = (typeof EXTRA_HEADERS)[number]

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  const selectedHeaders = parseHeaders(request.nextUrl.searchParams.get('headers'))
  const selectedExtraHeaders = parseExtraHeaders(request.nextUrl.searchParams.get('extraHeaders'))
  const isTemplate = request.nextUrl.searchParams.get('template') === '1'
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(isTemplate ? '업로드양식' : '품목')

  sheet.columns = [
    ...selectedHeaders.map((header) => ({ header, key: header, width: Math.max(14, Math.min(32, header.length + 6)) })),
    ...(!isTemplate && selectedExtraHeaders.includes('구매 URL 상태') ? [{ header: '구매 URL 상태', key: 'purchaseUrlStatus', width: 14 }] : []),
    ...(!isTemplate && selectedExtraHeaders.includes('당월 출고수량') ? [{ header: '당월 출고수량', key: 'currentMonthOutgoing', width: 16 }] : []),
    ...(!isTemplate && selectedExtraHeaders.includes('3개월 평균 출고수량') ? [{ header: '3개월 평균 출고수량', key: 'threeMonthAverageOutgoing', width: 20 }] : []),
    ...(!isTemplate && selectedExtraHeaders.includes('최근 반영일') ? [{ header: '최근 반영일', key: 'updatedAt', width: 22 }] : []),
  ]
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: 'A1', to: { row: 1, column: sheet.columns.length } }

  const headerRow = sheet.getRow(1)
  headerRow.height = 24
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })

  if (isTemplate) {
    addTemplateRows(sheet, selectedHeaders)
  } else {
    const items = await getAllPurchasingItems(await getWorkspaceUserId(user.id))
    for (const item of items) {
      sheet.addRow({
        ...Object.fromEntries(selectedHeaders.map((header) => [header, item.data[header] ?? null])),
        purchaseUrlStatus: purchaseUrlExportStatus(item.data, item.purchaseUrlVerificationStatus),
        currentMonthOutgoing: item.outgoingMetrics.currentMonthOutgoing,
        threeMonthAverageOutgoing: item.outgoingMetrics.threeMonthAverageOutgoing,
        updatedAt: item.updatedAt.toLocaleString('ko-KR'),
      })
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  const baseName = isTemplate ? '품목업로드양식' : '품목다운로드'
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${baseName}_${date}.xlsx`)}`,
    },
  })
}

function parseHeaders(value: string | null): Esa009mHeader[] {
  if (!value) return [...ESA009M_HEADERS]
  const requested = value.split(',').map((header) => header.trim()).filter(Boolean)
  const selected = requested.filter((header): header is Esa009mHeader => (
    ESA009M_HEADERS.includes(header as Esa009mHeader)
  ))
  const withCode = selected.includes('품목코드') ? selected : ['품목코드', ...selected]
  return Array.from(new Set(withCode))
}

function parseExtraHeaders(value: string | null): ExtraHeader[] {
  if (!value) return [...EXTRA_HEADERS]
  const requested = value.split(',').map((header) => header.trim()).filter(Boolean)
  return requested.filter((header): header is ExtraHeader => EXTRA_HEADERS.includes(header as ExtraHeader))
}

function addTemplateRows(sheet: ExcelJS.Worksheet, headers: Esa009mHeader[]) {
  const example = Object.fromEntries(headers.map((header) => [header, '']))
  example['품목코드'] = '100000-0001'
  if ('품목명' in example) example['품목명'] = '샘플 상품명'
  if ('works 신규 원가' in example) example['works 신규 원가'] = '1000'
  if ('구매 URL' in example) example['구매 URL'] = 'https://detail.1688.com/offer/example.html'
  sheet.addRow(example)
}
