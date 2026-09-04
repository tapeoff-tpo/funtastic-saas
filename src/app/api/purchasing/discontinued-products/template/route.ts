import { NextResponse } from 'next/server'
import { createDiscontinuedProductTemplate } from '@/lib/purchasing/discontinued-product-file'

export const runtime = 'nodejs'

export async function GET() {
  const file = await createDiscontinuedProductTemplate()
  return new NextResponse(file, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('단종상품_로우데이터_양식.xlsx')}`,
      'Cache-Control': 'no-store',
    },
  })
}
