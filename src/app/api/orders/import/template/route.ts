import { NextResponse } from 'next/server'
import { generateOrderTemplate } from '@/lib/orders/excel-template'

/**
 * GET /api/orders/import/template
 *
 * Download a blank order import Excel template.
 */
export async function GET() {
  const buffer = await generateOrderTemplate()

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="order-import-template.xlsx"',
    },
  })
}
