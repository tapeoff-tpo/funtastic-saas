import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import {
  applyDiscontinuedProductActions,
  getDiscontinuedProductMatchSummary,
  getStoredDiscontinuedProductRawFile,
  saveStoredDiscontinuedProductRawFile,
} from '@/lib/purchasing/discontinued-products'
import { parseDiscontinuedProductFile } from '@/lib/purchasing/discontinued-product-file'
import { recordDataRefresh } from '@/lib/purchasing/data-freshness'
import { createClient } from '@/lib/supabase/server'

const MAX_FILE_SIZE = 4 * 1024 * 1024

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  try {
    const form = await request.formData()
    const mode = form.get('mode') === 'apply' ? 'apply' : 'preview'
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: '단종상품 파일을 선택해주세요.' }, { status: 400 })
    }
    if (!/\.xlsx$/i.test(file.name)) {
      return NextResponse.json({ error: '엑셀 파일(.xlsx)만 업로드할 수 있습니다.' }, { status: 400 })
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: '단종상품 파일은 4MB 이하여야 합니다.' }, { status: 400 })
    }

    const workspaceUserId = await getWorkspaceUserId(user.id)
    const upload = {
      fileName: file.name.slice(0, 255),
      fileBuffer: await file.arrayBuffer(),
    }
    let parsed: Awaited<ReturnType<typeof parseDiscontinuedProductFile>>
    try {
      parsed = await parseDiscontinuedProductFile(upload)
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : '단종상품 파일 형식을 확인하지 못했습니다.',
      }, { status: 400 })
    }
    const matchSummary = await getDiscontinuedProductMatchSummary(workspaceUserId, parsed.actions)
    const summary = {
      fileName: parsed.fileName,
      totalDataRows: parsed.totalDataRows,
      uniqueSkuCount: parsed.actions.length,
      discontinuedSkuCount: parsed.actions.length,
      duplicateSkus: parsed.duplicateSkus,
      registeredSkuCount: matchSummary.registeredSkuCount,
      unregisteredSkus: matchSummary.unregisteredSkus,
    }

    if (mode === 'preview') {
      return NextResponse.json({
        mode,
        summary,
        storedFile: await getStoredDiscontinuedProductRawFile(workspaceUserId),
      })
    }

    const result = await applyDiscontinuedProductActions({
      userId: workspaceUserId,
      actions: parsed.actions,
    })
    await saveStoredDiscontinuedProductRawFile({ userId: workspaceUserId, upload })
    await recordDataRefresh({
      userId: workspaceUserId,
      source: 'purchasing_raw:discontinuedProducts',
      metadata: { fileName: upload.fileName },
    })
    revalidatePath('/purchasing/raw-data')
    revalidatePath('/purchasing/orders')
    revalidatePath('/purchasing/purchases')
    revalidatePath('/purchasing/overdue')
    revalidatePath('/costs')
    return NextResponse.json({
      mode,
      summary,
      result,
      storedFile: await getStoredDiscontinuedProductRawFile(workspaceUserId),
    })
  } catch (error) {
    console.error('[purchasing-discontinued-products]', error)
    return NextResponse.json({
      error: error instanceof Error && error.message
        ? error.message
        : '단종상품 파일을 처리하지 못했습니다.',
    }, { status: 500 })
  }
}
