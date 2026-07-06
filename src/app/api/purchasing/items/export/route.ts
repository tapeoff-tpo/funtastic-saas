import ExcelJS from 'exceljs'
import { NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { createClient } from '@/lib/supabase/server'
import { ESA009M_HEADERS, getAllPurchasingItems } from '@/lib/purchasing/items'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  const items = await getAllPurchasingItems(await getWorkspaceUserId(user.id))
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('품목')

  sheet.columns = [
    ...ESA009M_HEADERS.map((header) => ({ header, key: header, width: Math.max(14, Math.min(32, header.length + 6)) })),
    { header: '당월 출고수량', key: 'currentMonthOutgoing', width: 16 },
    { header: '3개월 평균 출고수량', key: 'threeMonthAverageOutgoing', width: 20 },
    { header: '최근 반영일', key: 'updatedAt', width: 22 },
  ]
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: 'A1', to: { row: 1, column: ESA009M_HEADERS.length + 1 } }

  const headerRow = sheet.getRow(1)
  headerRow.height = 24
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })

  for (const item of items) {
    sheet.addRow({
      ...item.data,
      updatedAt: item.updatedAt.toLocaleString('ko-KR'),
    })
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`품목전체_${date}.xlsx`)}`,
    },
  })
}
