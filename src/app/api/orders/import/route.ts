import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseOrderExcel, importOrders } from '@/lib/orders/excel-import'

/**
 * POST /api/orders/import
 *
 * Upload an Excel file to import orders.
 * FormData: file (xlsx), marketplaceId (string)
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const marketplaceId = formData.get('marketplaceId') as string | null

  if (!file) {
    return NextResponse.json({ error: '파일을 선택해주세요' }, { status: 400 })
  }

  if (!marketplaceId) {
    return NextResponse.json({ error: '마켓플레이스를 선택해주세요' }, { status: 400 })
  }

  // Validate file type
  const validTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
  ]
  if (!validTypes.includes(file.type) && !file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
    return NextResponse.json({ error: 'Excel 파일(.xlsx)만 업로드할 수 있습니다' }, { status: 400 })
  }

  try {
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Parse Excel
    const parseResult = await parseOrderExcel(buffer)

    if (parseResult.rows.length === 0 && parseResult.errors.length > 0) {
      return NextResponse.json({
        imported: 0,
        skipped: 0,
        errors: parseResult.errors,
      })
    }

    if (parseResult.rows.length === 0) {
      return NextResponse.json({
        imported: 0,
        skipped: 0,
        errors: [{ row: 0, errors: ['데이터가 없습니다'] }],
      })
    }

    // Import into DB
    const result = await importOrders(
      parseResult.rows,
      marketplaceId,
      user.id,
    )

    return NextResponse.json({
      imported: result.imported,
      skipped: result.skipped,
      errors: [...parseResult.errors, ...result.errors],
    })
  } catch (error) {
    console.error('[OrderImport] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '파일 처리 중 오류가 발생했습니다' },
      { status: 500 }
    )
  }
}
