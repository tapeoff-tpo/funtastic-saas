import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { createClient } from '@/lib/supabase/server'
import {
  getEcountPurchasingSyncState,
  parseEcountPurchasingSnapshot,
  summarizeEcountPurchasingSnapshot,
  syncEcountPurchasingSnapshot,
  type EcountPurchasingUpload,
} from '@/lib/purchasing/ecount-purchasing-sync'

const REQUIRED_FILE_COUNT = 5
const MAX_TOTAL_SIZE = 4 * 1024 * 1024

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  try {
    const form = await request.formData()
    const mode = form.get('mode') === 'apply' ? 'apply' : 'preview'
    const files = form.getAll('files').filter((value): value is File => value instanceof File)
    if (files.length !== REQUIRED_FILE_COUNT) {
      return NextResponse.json({ error: `필수 원본 파일 ${REQUIRED_FILE_COUNT}개를 모두 선택해주세요.` }, { status: 400 })
    }
    if (files.some((file) => !/\.xlsx$/i.test(file.name))) {
      return NextResponse.json({ error: '엑셀 파일(.xlsx)만 업로드할 수 있습니다.' }, { status: 400 })
    }
    const totalSize = files.reduce((sum, file) => sum + file.size, 0)
    if (totalSize > MAX_TOTAL_SIZE) {
      return NextResponse.json({ error: '파일 전체 용량은 4MB 이하여야 합니다.' }, { status: 400 })
    }

    const uploads: EcountPurchasingUpload[] = await Promise.all(files.map(async (file) => ({
      fileName: file.name.slice(0, 255),
      fileBuffer: await file.arrayBuffer(),
    })))
    const snapshot = await parseEcountPurchasingSnapshot({
      files: uploads,
      asOfDate: requiredText(form, 'asOfDate'),
      domesticInventoryReflectedThrough: requiredText(form, 'domesticInventoryReflectedThrough'),
      purchasePlanConfirmedSince: requiredText(form, 'purchasePlanConfirmedSince'),
    })
    const summary = summarizeEcountPurchasingSnapshot(snapshot)
    const workspaceUserId = await getWorkspaceUserId(user.id)

    if (mode === 'preview') {
      return NextResponse.json({ mode, summary, currentState: await getEcountPurchasingSyncState(workspaceUserId) })
    }

    const result = await syncEcountPurchasingSnapshot({
      userId: workspaceUserId,
      requestedByUserId: user.id,
      snapshot,
    })
    revalidatePath('/purchasing/raw-data')
    revalidatePath('/purchasing/purchases')
    revalidatePath('/purchasing/orders')
    revalidatePath('/purchasing/china-inventory')
    revalidatePath('/purchasing/overdue')
    return NextResponse.json({
      mode,
      summary,
      result,
      currentState: await getEcountPurchasingSyncState(workspaceUserId),
    })
  } catch (error) {
    console.error('[purchasing-raw-data]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '발주 로우데이터 처리에 실패했습니다.' },
      { status: 500 },
    )
  }
}

function requiredText(form: FormData, key: string) {
  const value = form.get(key)
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} 값을 입력해주세요.`)
  return value.trim()
}
