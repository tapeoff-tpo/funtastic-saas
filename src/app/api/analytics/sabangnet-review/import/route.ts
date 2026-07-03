import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { db } from '@/lib/db'
import { excelImportTemplates } from '@/lib/db/schema'
import { DEFAULT_ORDER_IMPORT_TEMPLATES, findDefaultOrderImportTemplate } from '@/lib/orders/default-import-templates'
import type { OrderImportMapping } from '@/lib/orders/excel-import-fields'
import { importSabangnetReviewBatch } from '@/lib/analytics/sabangnet-review'
import { InvalidExcelWorkbookError } from '@/lib/orders/excel-workbook-buffer'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const marketplaceId = String(formData.get('marketplaceId') ?? '').trim()
  const marketplaceName = String(formData.get('marketplaceName') ?? '').trim()
  const templateId = String(formData.get('templateId') ?? '').trim()

  if (!file) return NextResponse.json({ error: '파일을 선택해 주세요.' }, { status: 400 })
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return NextResponse.json({ error: 'Excel .xlsx 파일만 업로드할 수 있습니다.' }, { status: 400 })
  }

  try {
    let mappings: OrderImportMapping[] | undefined
    if (templateId.startsWith('default:')) {
      const template = DEFAULT_ORDER_IMPORT_TEMPLATES.find((candidate) => candidate.id === templateId)
      if (!template) return NextResponse.json({ error: '선택한 기본 양식을 찾을 수 없습니다.' }, { status: 400 })
      mappings = template.mappings
    } else if (templateId) {
      const [template] = await db
        .select({ mappings: excelImportTemplates.mappings })
        .from(excelImportTemplates)
        .where(and(eq(excelImportTemplates.id, templateId), eq(excelImportTemplates.userId, workspaceUserId)))
        .limit(1)
      if (!template) return NextResponse.json({ error: '선택한 업로드 양식을 찾을 수 없습니다.' }, { status: 400 })
      mappings = template.mappings
    } else {
      mappings = findDefaultOrderImportTemplate(
        marketplaceId || file.name,
        marketplaceName || file.name,
      )?.mappings
    }

    const result = await importSabangnetReviewBatch({
      userId: workspaceUserId,
      fileName: file.name,
      fileBuffer: await file.arrayBuffer(),
      mappings,
      fallbackMarketplaceId: marketplaceId || undefined,
      fallbackMarketplaceName: marketplaceName || undefined,
    })

    revalidatePath('/analytics/sabangnet-review')
    return NextResponse.json(result)
  } catch (error) {
    console.error('[SabangnetReviewImport] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '사방넷 검수 파일 처리 중 오류가 발생했습니다.' },
      { status: error instanceof InvalidExcelWorkbookError ? 400 : 500 },
    )
  }
}
