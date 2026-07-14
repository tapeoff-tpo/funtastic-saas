import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import {
  ESA009M_HEADERS,
  type Esa009mHeader,
  importPurchasingItems,
  type PurchasingItemImportMode,
  previewPurchasingItemsImport,
} from '@/lib/purchasing/items'

const IMPORT_MODES = new Set<PurchasingItemImportMode>(['cost-url-and-new', 'new-only', 'selected'])

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  try {
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'ESA009M 엑셀 파일을 선택해주세요.' }, { status: 400 })
    }
    const intent = String(form.get('intent') ?? 'apply')
    const input = {
      userId: await getWorkspaceUserId(user.id),
      fileBuffer: await file.arrayBuffer(),
      options: {
        mode: parseMode(form.get('mode')),
        selectedHeaders: parseSelectedHeaders(form.get('selectedHeaders')),
        createMissing: String(form.get('createMissing') ?? '') === 'true',
      },
    }

    if (intent === 'preview') {
      const result = await previewPurchasingItemsImport(input)
      return NextResponse.json(result)
    }
    if (intent !== 'apply') {
      return NextResponse.json({ error: '알 수 없는 업로드 요청입니다.' }, { status: 400 })
    }

    const result = await importPurchasingItems(input)
    revalidatePath('/products')
    revalidatePath('/costs')
    revalidatePath('/purchasing/items')
    return NextResponse.json(result)
  } catch (error) {
    console.error('[purchasing-items-import]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '품목 엑셀 업로드에 실패했습니다.' },
      { status: 500 },
    )
  }
}

function parseMode(value: FormDataEntryValue | null): PurchasingItemImportMode {
  const mode = String(value ?? 'cost-url-and-new') as PurchasingItemImportMode
  return IMPORT_MODES.has(mode) ? mode : 'cost-url-and-new'
}

function parseSelectedHeaders(value: FormDataEntryValue | null): Esa009mHeader[] {
  if (typeof value !== 'string' || !value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((header): header is Esa009mHeader => (
      typeof header === 'string' && ESA009M_HEADERS.includes(header as Esa009mHeader)
    ))
  } catch {
    return []
  }
}
