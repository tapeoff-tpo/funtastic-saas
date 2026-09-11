import { gunzipSync } from 'node:zlib'
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
import {
  PURCHASING_RAW_BUNDLE_CONTENT_TYPE,
  unpackPurchasingRawDataBundle,
  type PurchasingRawDataBundleFields,
} from '@/lib/purchasing/raw-data-upload-bundle'

const MAX_TOTAL_SIZE = 4 * 1024 * 1024
const MAX_BUNDLED_TOTAL_SIZE = 25 * 1024 * 1024
const MAX_UNPACKED_BUNDLE_SIZE = MAX_BUNDLED_TOTAL_SIZE + 256 * 1024
const REPORT_KINDS: EcountReportKind[] = ['purchaseRequest', 'purchasePlan', 'purchaseHistory', 'chinaInventory', 'chinaOutbound']

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  try {
    let uploadRequest: Awaited<ReturnType<typeof readPurchasingRawDataRequest>>
    try {
      uploadRequest = await readPurchasingRawDataRequest(request)
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : '업로드 파일을 읽지 못했습니다.',
      }, { status: 400 })
    }
    const { mode, fields, uploads } = uploadRequest
    if (uploads.length === 0 || uploads.length > REPORT_KINDS.length) {
      return NextResponse.json({ error: '변경할 원본 파일을 1~5개 선택해주세요.' }, { status: 400 })
    }
    if (uploads.some((file) => !/\.xlsx$/i.test(file.fileName))) {
      return NextResponse.json({ error: '엑셀 파일(.xlsx)만 업로드할 수 있습니다.' }, { status: 400 })
    }
    const totalSize = uploads.reduce((sum, file) => sum + file.fileBuffer.byteLength, 0)
    const uploadLimit = uploadRequest.transport === 'gzip-bundle' ? MAX_BUNDLED_TOTAL_SIZE : MAX_TOTAL_SIZE
    if (totalSize > uploadLimit) {
      return NextResponse.json({
        error: uploadRequest.transport === 'gzip-bundle'
          ? '압축 해제한 파일 전체 용량은 25MB 이하여야 합니다.'
          : '파일 전체 용량은 4MB 이하여야 합니다.',
      }, { status: 400 })
    }

    const workspaceUserId = await getWorkspaceUserId(user.id)
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
        asOfDate: fields.asOfDate,
        domesticInventoryReflectedThrough: fields.domesticInventoryReflectedThrough,
        purchasePlanConfirmedSince: fields.purchasePlanConfirmedSince,
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
      { error: getPurchasingRawDataErrorMessage(error) },
      { status: 500 },
    )
  }
}

async function readPurchasingRawDataRequest(request: NextRequest): Promise<{
  mode: 'preview' | 'apply'
  fields: PurchasingRawDataBundleFields
  uploads: EcountPurchasingUpload[]
  transport: 'multipart' | 'gzip-bundle'
}> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
  if (contentType === PURCHASING_RAW_BUNDLE_CONTENT_TYPE) {
    const compressed = await request.arrayBuffer()
    if (compressed.byteLength === 0 || compressed.byteLength > MAX_TOTAL_SIZE) {
      throw new Error('압축 업로드 데이터는 4MB 이하여야 합니다.')
    }

    let unpackedBytes: Uint8Array
    try {
      const uncompressed = gunzipSync(Buffer.from(compressed), {
        maxOutputLength: MAX_UNPACKED_BUNDLE_SIZE,
      })
      unpackedBytes = new Uint8Array(uncompressed.buffer, uncompressed.byteOffset, uncompressed.byteLength)
    } catch {
      throw new Error('압축 업로드 파일을 풀지 못했습니다. 파일을 다시 선택해주세요.')
    }
    const unpacked = unpackPurchasingRawDataBundle(unpackedBytes)
    return {
      mode: unpacked.fields.mode,
      fields: unpacked.fields,
      uploads: unpacked.files.map((file) => ({
        fileName: file.name.slice(0, 255),
        fileBuffer: file.bytes.slice().buffer as ArrayBuffer,
      })),
      transport: 'gzip-bundle',
    }
  }

  const form = await request.formData()
  const files = form.getAll('files').filter((value): value is File => value instanceof File)
  return {
    mode: form.get('mode') === 'apply' ? 'apply' : 'preview',
    fields: {
      mode: form.get('mode') === 'apply' ? 'apply' : 'preview',
      asOfDate: requiredText(form, 'asOfDate'),
      domesticInventoryReflectedThrough: requiredText(form, 'domesticInventoryReflectedThrough'),
      purchasePlanConfirmedSince: requiredText(form, 'purchasePlanConfirmedSince'),
    },
    uploads: await Promise.all(files.map(async (file) => ({
      fileName: file.name.slice(0, 255),
      fileBuffer: await file.arrayBuffer(),
    }))),
    transport: 'multipart',
  }
}

function getPurchasingRawDataErrorMessage(error: unknown) {
  const causes = errorChain(error)
  const databaseCode = causes.find((cause) => typeof cause.code === 'string')?.code
  if (databaseCode === '23505') {
    return '같은 발주 원본 행이 중복되어 반영하지 못했습니다. 파일을 다시 내려받아 올리거나, 중복 행을 확인해주세요.'
  }
  if (databaseCode === '40P01' || databaseCode === '55P03') {
    return '다른 데이터 반영 작업과 동시에 처리되어 반영하지 못했습니다. 잠시 후 최종 반영을 다시 눌러주세요.'
  }

  const safeMessage = causes
    .map((cause) => cause.message)
    .find((message): message is string => (
      typeof message === 'string' && message.length > 0 && !message.startsWith('Failed query:')
    ))
  return safeMessage ?? '발주 로우데이터 반영 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
}

function errorChain(error: unknown) {
  const causes: Array<{ message?: string; code?: string }> = []
  const seen = new Set<unknown>()
  let current = error
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current)
    const candidate = current as { message?: unknown; code?: unknown; cause?: unknown }
    causes.push({
      message: typeof candidate.message === 'string' ? candidate.message : undefined,
      code: typeof candidate.code === 'string' ? candidate.code : undefined,
    })
    current = candidate.cause
  }
  return causes
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
