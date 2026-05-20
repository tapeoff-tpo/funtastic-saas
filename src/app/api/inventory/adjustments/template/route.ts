import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'

export const runtime = 'nodejs'

const reasonOptions = ['입고', '차감', '실사조정', '불용/불량', '기타']

export async function GET() {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('재고조정')

  sheet.columns = [
    { header: '상품코드', key: 'sku', width: 18 },
    { header: '사유', key: 'reason', width: 14 },
    { header: '입고증가/차감', key: 'delta', width: 16 },
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
      reason: '입고',
      delta: 10,
    },
    {
      sku: '111090-0002',
      reason: '차감',
      delta: -3,
    },
  ])

  for (let rowNum = 2; rowNum <= 1000; rowNum += 1) {
    sheet.getCell(`B${rowNum}`).dataValidation = {
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
