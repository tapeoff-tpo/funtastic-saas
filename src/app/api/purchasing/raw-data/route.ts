import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { createClient } from '@/lib/supabase/server'
import {
  classifyEcountPurchasingUpload,
  getEcountChinaInventorySnapshotDate,
  getEcountReportLabel,
  getLatestChinaInventorySnapshotAsOfDate,
  getPersistedPurchaseHistoryBridgeKeys,
  getPurchaseHistoryBridgeKeyFromRawRow,
  getPurchaseHistoryBridgeKeysAfterChinaInventorySnapshot,
  getEcountPurchasingSyncState,
  parseEcountPurchasingSnapshot,
  readEcountPurchasingRawFileRows,
  summarizeEcountPurchasingSnapshot,
  syncEcountPurchasingSnapshot,
  type EcountPurchasingUpload,
  type EcountReportKind,
} from '@/lib/purchasing/ecount-purchasing-sync'
import {
  getNewIncrementalEcountRawRows,
  getStoredEcountRawFiles,
  mergeEcountRawFiles,
  saveStoredEcountRawFiles,
  summarizeStoredEcountRawFiles,
  type StoredEcountRawFile,
} from '@/lib/purchasing/ecount-raw-files'
import { recordDataRefresh } from '@/lib/purchasing/data-freshness'

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
    let accumulated: StoredEcountRawFile[]
    try {
      accumulated = await mergeEcountRawFiles(stored, classified)
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? `기존 누적 원본과 새 파일을 합치지 못했습니다: ${error.message}` : '기존 누적 원본과 새 파일을 합치지 못했습니다.',
      }, { status: 400 })
    }
    const combined = new Map<EcountReportKind, StoredEcountRawFile>(stored.map((file) => [file.kind, file]))
    for (const file of accumulated) combined.set(file.kind, file)
    const changedKinds = classified.map((file) => file.kind)
    const purchaseHistoryBridgeKeys = await getPurchaseHistoryBridgeKeys({
      userId: workspaceUserId,
      stored,
      incoming: classified,
      combinedFiles: [...combined.values()],
      chinaInventoryWasUpdated: changedKinds.includes('chinaInventory'),
    })
    let snapshot
    try {
      snapshot = await parseEcountPurchasingSnapshot({
        files: [...combined.values()],
        asOfDate: requiredText(form, 'asOfDate'),
        domesticInventoryReflectedThrough: requiredText(form, 'domesticInventoryReflectedThrough'),
        purchasePlanConfirmedSince: requiredText(form, 'purchasePlanConfirmedSince'),
        allowMissingReports: true,
        purchaseHistoryBridgeKeys,
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
        changedKinds,
        currentState: await getEcountPurchasingSyncState(workspaceUserId),
      })
    }

    const result = await syncEcountPurchasingSnapshot({
      userId: workspaceUserId,
      requestedByUserId: user.id,
      snapshot,
      reportKinds: changedKinds,
    })
    await saveStoredEcountRawFiles(workspaceUserId, accumulated)
    await Promise.all(classified.map((file) => recordDataRefresh({
      userId: workspaceUserId,
      source: `purchasing_raw:${file.kind}`,
      metadata: { fileName: file.fileName },
    })))
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
      changedKinds,
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

async function getPurchaseHistoryBridgeKeys(input: {
  userId: string
  stored: StoredEcountRawFile[]
  incoming: StoredEcountRawFile[]
  combinedFiles: StoredEcountRawFile[]
  chinaInventoryWasUpdated: boolean
}) {
  const historyFile = input.combinedFiles.find((file) => file.kind === 'purchaseHistory')
  const chinaInventoryFile = input.combinedFiles.find((file) => file.kind === 'chinaInventory')
  const [persistedKeys, newHistoryRows, historyRows, reportSnapshotDate] = await Promise.all([
    input.chinaInventoryWasUpdated
      ? Promise.resolve([])
      : getPersistedPurchaseHistoryBridgeKeys(input.userId),
    getNewIncrementalEcountRawRows(input.stored, input.incoming, 'purchaseHistory'),
    historyFile
      ? readEcountPurchasingRawFileRows(historyFile).then((report) => report.rows)
      : Promise.resolve([]),
    chinaInventoryFile
      ? getEcountChinaInventorySnapshotDate(chinaInventoryFile)
      : Promise.resolve(null),
  ])
  const inventorySnapshotDate = reportSnapshotDate
    ?? (input.chinaInventoryWasUpdated
      ? null
      : await getLatestChinaInventorySnapshotAsOfDate(input.userId))
  const keys = new Set(persistedKeys)
  const addBridgeKey = (row: Record<string, string>) => {
    if (row['진행상태'] !== '확인') return
    keys.add(getPurchaseHistoryBridgeKeyFromRawRow(row))
  }
  for (const key of getPurchaseHistoryBridgeKeysAfterChinaInventorySnapshot(
    historyRows,
    inventorySnapshotDate,
  )) {
    keys.add(key)
  }
  if (!input.chinaInventoryWasUpdated) {
    for (const row of newHistoryRows) addBridgeKey(row)
  }
  return [...keys]
}
