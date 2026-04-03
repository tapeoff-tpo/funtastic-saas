/**
 * POST /api/products/import
 *
 * Bulk import products from an uploaded Excel file.
 * Accepts multipart/form-data with an .xlsx file.
 * Parses, validates, and creates/updates products in bulk.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseProductExcel, bulkImportProducts } from '@/lib/products/excel-import'

export async function POST(request: NextRequest) {
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

    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json(
        { error: 'file 파라미터가 필요합니다' },
        { status: 400 },
      )
    }

    // Validate file type
    const validTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ]
    if (!validTypes.includes(file.type) && !file.name.endsWith('.xlsx')) {
      return NextResponse.json(
        { error: 'Excel 파일(.xlsx)만 업로드할 수 있습니다' },
        { status: 400 },
      )
    }

    // Read file buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Parse Excel
    const parseResult = await parseProductExcel(buffer)

    if (parseResult.products.length === 0 && parseResult.errors.length > 0) {
      return NextResponse.json({
        created: 0,
        updated: 0,
        parseErrors: parseResult.errors,
        importErrors: [],
      })
    }

    // Execute bulk import
    const importResult = await bulkImportProducts(user.id, parseResult.products)

    return NextResponse.json({
      created: importResult.created,
      updated: importResult.updated,
      parseErrors: parseResult.errors,
      importErrors: importResult.errors,
    })
  } catch (error) {
    console.error('Product Excel import error:', error)
    return NextResponse.json(
      { error: '엑셀 파일 처리 중 오류가 발생했습니다' },
      { status: 500 },
    )
  }
}
