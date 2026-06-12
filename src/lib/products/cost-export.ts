import ExcelJS from 'exceljs'
import { getProducts } from './queries'
import type { ProductFilters, ProductListItem } from './types'

const COST_COLUMNS: Array<{ header: string; key: string; width: number }> = [
  { header: '품목코드', key: 'internalSku', width: 18 },
  { header: '품목명', key: 'name', width: 42 },
  { header: 'works 신규 원가', key: 'newCostPrice', width: 16 },
  { header: 'works 기존 원가', key: 'existingCostPrice', width: 16 },
  { header: '한국창고기준 위치', key: 'warehouseLocation', width: 20 },
]

const HEADER_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE0E0E0' },
}

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
}

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
}

function costValue(product: ProductListItem): number | '' {
  if (!product.costPrice) return ''
  const value = Number(product.costPrice)
  return Number.isFinite(value) ? value : ''
}

export async function exportProductCostsToExcel(
  userId: string,
  filters: ProductFilters = {},
): Promise<Buffer> {
  const pageSize = 10000
  let page = 1
  let total = 0
  const allProducts: ProductListItem[] = []

  do {
    const result = await getProducts(userId, {
      ...filters,
      page,
      pageSize,
    })
    total = result.total
    allProducts.push(...result.items)
    page += 1
  } while (allProducts.length < total)

  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('품목')

  worksheet.columns = COST_COLUMNS.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width,
  }))

  worksheet.getRow(1).eachCell((cell) => {
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.border = THIN_BORDER
  })

  for (const product of allProducts) {
    const cost = costValue(product)
    worksheet.addRow({
      internalSku: product.internalSku,
      name: product.name,
      newCostPrice: cost,
      existingCostPrice: cost,
      warehouseLocation: product.warehouseLocation ?? '',
    })
  }

  worksheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = THIN_BORDER
    })
  })

  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return arrayBuffer as unknown as Buffer
}
