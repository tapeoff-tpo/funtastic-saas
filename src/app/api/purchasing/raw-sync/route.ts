import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import {
  getEcountPurchasingSyncState,
  parseEcountPurchasingSnapshot,
  summarizeEcountPurchasingSnapshot,
  syncEcountPurchasingSnapshot,
} from '@/lib/purchasing/ecount-purchasing-sync'
import { createClient } from '@/lib/supabase/server'

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024
const REQUIRED_FILE_COUNT = 5

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const form = await request.formData()
  const intent = String(form.get('intent') ?? 'preview')
  const domesticInventoryReflectedThrough = String(form.get('domesticInventoryReflectedThrough') ?? '').trim()
  const files = form.getAll('files').filter((value): value is File => value instanceof File)

  if (files.length !== REQUIRED_FILE_COUNT) {
    return NextResponse.json(
      { error: '발주 요청 현황, 발주 계획 현황, 구매 현황, 중국재고, 중국 출고 파일 5개를 모두 선택해주세요.' },
      { status: 400 },
    )
  }
  const invalidFile = files.find((file) => (
    !file.name.toLowerCase().endsWith('.xlsx') || file.size === 0 || file.size > MAX_FILE_SIZE_BYTES
  ))
  if (invalidFile) {
    return NextResponse.json(
      { error: `${invalidFile.name}: 0바이트 초과, 20MB 이하의 .xlsx 파일만 사용할 수 있습니다.` },
      { status: 400 },
    )
  }

  try {
    const workspaceUserId = await getWorkspaceUserId(user.id)
    const snapshot = await parseEcountPurchasingSnapshot({
      domesticInventoryReflectedThrough,
      files: await Promise.all(files.map(async (file) => ({
        fileName: file.name.slice(0, 255),
        fileBuffer: await file.arrayBuffer(),
      }))),
    })
    const preview = summarizeEcountPurchasingSnapshot(snapshot)
    const current = await getEcountPurchasingSyncState(workspaceUserId)

    if (intent === 'preview') {
      return NextResponse.json({ preview, current })
    }
    if (intent !== 'apply') {
      return NextResponse.json({ error: '지원하지 않는 동기화 요청입니다.' }, { status: 400 })
    }
    if (String(form.get('confirm') ?? '') !== 'replace') {
      return NextResponse.json({ error: '원본 교체 확인이 필요합니다.' }, { status: 400 })
    }

    const result = await syncEcountPurchasingSnapshot({
      userId: workspaceUserId,
      requestedByUserId: user.id,
      snapshot,
    })

    revalidatePath('/purchasing/purchases')
    revalidatePath('/purchasing/orders')
    revalidatePath('/purchasing/overdue')
    revalidatePath('/purchasing/china-inventory')

    return NextResponse.json({ preview, current, result })
  } catch (error) {
    console.error('[purchasing-raw-sync]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Ecount 원본 동기화에 실패했습니다.' },
      { status: intent === 'apply' ? 409 : 400 },
    )
  }
}
