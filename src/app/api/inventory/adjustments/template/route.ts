import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'

export const runtime = 'nodejs'

const reasonOptions = ['입고', '출고', '실사조정', '불용/불량', '기타']

export async function GET() {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('재고조정')

  sheet.columns = [
    { header: '상품코드', key: 'sku', width: 18 },
    { header: '창고', key: 'warehouseZone', width: 14 },
    { header: '로케이션', key: 'sectorCode', width: 16 },
    { header: '변동수량', key: 'delta', width: 12 },
    { header: '사유', key: 'reason', width: 14 },
    { header: '메모', key: 'note', width: 28 },
  ]

  const header = sheet.getRow(1)
  header.height = 22
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FF111827' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    }
  })

  sheet.addRows([
    {
      sku: '111090-0002',
      warehouseZone: '1창고',
      sectorCode: 'A-01',
      delta: 10,
      reason: '입고',
      note: '양수는 입고/증가',
    },
    {
      sku: '111090-0002',
      warehouseZone: '쿠팡',
      sectorCode: 'C-02',
      delta: -3,
      reason: '출고',
      note: '음수는 출고/차감',
    },
  ])

  for (let rowNum = 2; rowNum <= 1000; rowNum += 1) {
    sheet.getCell(`E${rowNum}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`"${reasonOptions.join(',')}"`],
    }
  }

  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  const buffer = await workbook.xlsx.writeBuffer()
  const filename = `재고조정_대량등록_양식_${new Date().toISOString().slice(0, 10)}.xlsx`

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}
