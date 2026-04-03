/**
 * GET /api/products/export
 *
 * Export products to Excel format.
 * Returns downloadable .xlsx file with product catalog.
 *
 * Query params:
 * - status: filter by product status (draft, active, inactive)
 * - categoryId: filter by category
 * - search: search by name or SKU
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exportProductsToExcel } from '@/lib/products/excel-export'
import type { ProductFilters, ProductStatus } from '@/lib/products/types'

export async function GET(request: NextRequest) {
  try {
    // Auth check
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: '인증이 필요합니다' },
        { status: 401 },
      )
    }

    // Parse query params
    const searchParams = request.nextUrl.searchParams
    const filters: ProductFilters = {}

    const status = searchParams.get('status')
    if (status && ['draft', 'active', 'inactive'].includes(status)) {
      filters.status = status as ProductStatus
    }

    const categoryId = searchParams.get('categoryId')
    if (categoryId) {
      filters.categoryId = categoryId
    }

    const search = searchParams.get('search')
    if (search) {
      filters.search = search
    }

    // Generate Excel
    const buffer = await exportProductsToExcel(user.id, filters)

    // Build filename with date
    const now = new Date()
    const dateStr = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('')
    const filename = `상품목록_${dateStr}.xlsx`

    // Return as downloadable file
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    })
  } catch (error) {
    console.error('Product export error:', error)
    return NextResponse.json(
      { error: '상품 목록 내보내기 중 오류가 발생했습니다' },
      { status: 500 },
    )
  }
}
