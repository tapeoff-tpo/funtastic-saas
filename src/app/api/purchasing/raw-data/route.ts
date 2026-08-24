import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { createClient } from '@/lib/supabase/server'
import {
  classifyEcountPurchasingUpload,
  getEcountReportLabel,
  getEcountPurchasingSyncState,
  parseEcountPurchasingSnapshot,
  summarizeEcountPurchasingSnapshot,
  syncEcountPurchasingSnapshot,
  type EcountPurchasingUpload,
  type EcountReportKind,
} from '@/lib/purchasing/ecount-purchasing-sync'
import {
  getStoredEcountRawFiles,
  saveStoredEcountRawFiles,
  summarizeStoredEcountRawFiles,
  type StoredEcountRawFile,
} from '@/lib/purchasing/ecount-raw-files'

const MAX_TOTAL_SIZE = 4 * 1024 * 1024
const REPORT_KINDS: EcountReportKind[] = ['purchaseRequest', 'purchasePlan', 'purchaseHistory', 'chinaInventory', 'chinaOutbound']

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
    if (files.length === 0 || files.length > REPORT_KINDS.length) {
      return NextResponse.json({ error: '변경할 원본 파일을 1~5개 선택해주세요.' }, { status: 400 })
    }
    if (files.some((file) => !/\.xlsx$/i.test(file.name))) {
      return NextResponse.json({ error: '엑셀 파일(.xlsx)만 업로드할 수 있습니다.' }, { status: 400 })
    }
    const totalSize = files.reduce((sum, file) => sum + file.size, 0)
    if (totalSize > MAX_TOTAL_SIZE) {
      return NextResponse.json({ error: '파일 전체 용량은 4MB 이하여야 합니다.' }, { status: 400 })
    }

    const workspaceUserId = await getWorkspaceUserId(user.id)
    const uploads: EcountPurchasingUpload[] = await Promise.all(files.map(async (file) => ({
      fileName: file.name.slice(0, 255),
      fileBuffer: await file.arrayBuffer(),
    })))
    const classified: StoredEcountRawFile[] = []
    for (const upload of uploads) {
      try {
        const { kind } = await classifyEcountPurchasingUpload(upload)
        if (classified.some((item) => item.kind === kind)) {
          return NextResponse.json({ error: `${getEcountReportLabel(kind)} 파일이 두 개 이상 선택되었습니다.` }, { status: 400 })
        }
        classified.push({ ...upload, kind, updatedAt: new Date().toISOString() })
      } catch (error) {
        const detail = error instanceof Error ? error.message : '파일 구조를 확인하지 못했습니다.'
        return NextResponse.json({
          error: detail.startsWith(`${upload.fileName}:`) ? detail : `${upload.fileName}: ${detail}`,
        }, { status: 400 })
      }
    }

    const stored = await getStoredEcountRawFiles(workspaceUserId)
    const combined = new Map<EcountReportKind, StoredEcountRawFile>(stored.map((file) => [file.kind, file]))
    for (const file of classified) combined.set(file.kind, file)
    if (mode === 'preview') await saveStoredEcountRawFiles(workspaceUserId, classified)
    const missingKinds = REPORT_KINDS.filter((kind) => !combined.has(kind))
    if (missingKinds.length > 0) {
      return NextResponse.json({
        error: `선택한 파일은 임시 저장했습니다. 나머지 파일도 올려주세요: ${missingKinds.map(getEcountReportLabel).join(', ')}`,
        recognizedFiles: Object.fromEntries(classified.map((file) => [file.kind, file.fileName])),
        storedFiles: summarizeStoredEcountRawFiles([...combined.values()]),
      }, { status: 400 })
    }

    let snapshot
    try {
      snapshot = await parseEcountPurchasingSnapshot({
        files: [...combined.values()],
        asOfDate: requiredText(form, 'asOfDate'),
        domesticInventoryReflectedThrough: requiredText(form, 'domesticInventoryReflectedThrough'),
        purchasePlanConfirmedSince: requiredText(form, 'purchasePlanConfirmedSince'),
      })
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : '파일 내용을 검증하지 못했습니다.',
      }, { status: 400 })
    }
    const summary = summarizeEcountPurchasingSnapshot(snapshot)

    if (mode === 'preview') {
      return NextResponse.json({
        mode,
        summary,
        storedFiles: summarizeStoredEcountRawFiles([...combined.values()]),
        changedKinds: classified.map((file) => file.kind),
        currentState: await getEcountPurchasingSyncState(workspaceUserId),
      })
    }

    const result = await syncEcountPurchasingSnapshot({
      userId: workspaceUserId,
      requestedByUserId: user.id,
      snapshot,
    })
    await saveStoredEcountRawFiles(workspaceUserId, classified)
    revalidatePath('/purchasing/raw-data')
    revalidatePath('/purchasing/purchases')
    revalidatePath('/purchasing/orders')
    revalidatePath('/purchasing/china-inventory')
    revalidatePath('/purchasing/overdue')
    return NextResponse.json({
      mode,
      summary,
      result,
      storedFiles: summarizeStoredEcountRawFiles([...combined.values()]),
      changedKinds: classified.map((file) => file.kind),
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
