import type { Metadata } from 'next'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, CircleDashed, FileSpreadsheet } from 'lucide-react'
import { and, eq } from 'drizzle-orm'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { db } from '@/lib/db'
import { excelImportTemplates, marketplaceConnections } from '@/lib/db/schema'
import { DEFAULT_ORDER_IMPORT_TEMPLATES } from '@/lib/orders/default-import-templates'
import {
  getOutboundReflectionLines,
  listOutboundReflectionBatches,
  type OutboundReflectionLine,
  type OutboundReflectionStatus,
} from '@/lib/outbound-reflection'
import { OutboundReflectionActions } from './outbound-reflection-actions'
import { OutboundReflectionBatchList } from './outbound-reflection-batch-list'
import { OutboundReflectionLineEdit } from './outbound-reflection-line-edit'

const DISPLAY_LIMIT = 300

export const metadata: Metadata = {
  title: '출고반영',
}

export default async function OutboundReflectionPage({
  searchParams,
}: {
  searchParams?: Promise<{ batch?: string; status?: string }>
}) {
  const user = await getCurrentUser()
  if (!user) return null

  const params = await searchParams
  const workspaceUserId = await getWorkspaceUserId(user.id)
  const selectedStatus = parseStatus(params?.status)
  const [batches, marketplaces, customTemplates] = await Promise.all([
    listOutboundReflectionBatches(workspaceUserId).catch((error) => {
      console.error('outbound reflection batches error:', error)
      return []
    }),
    db
      .select({ id: marketplaceConnections.marketplaceId, label: marketplaceConnections.displayName })
      .from(marketplaceConnections)
      .where(and(eq(marketplaceConnections.userId, workspaceUserId)))
      .orderBy(marketplaceConnections.displayName)
      .catch(() => []),
    db
      .select({ id: excelImportTemplates.id, label: excelImportTemplates.name })
      .from(excelImportTemplates)
      .where(eq(excelImportTemplates.userId, workspaceUserId))
      .orderBy(excelImportTemplates.name)
      .catch(() => []),
  ])

  const selectedBatchId = params?.batch ?? batches[0]?.id
  const selectedBatch = batches.find((batch) => batch.id === selectedBatchId)
  const lines = selectedBatchId
    ? await getOutboundReflectionLines(workspaceUserId, selectedBatchId, { status: selectedStatus, limit: DISPLAY_LIMIT }).catch((error) => {
      console.error('outbound reflection lines error:', error)
      return []
    })
    : []

  const totalRows = selectedBatch?.totalRows ?? 0
  const readyRows = selectedBatch?.readyRows ?? 0
  const blockedRows = selectedBatch?.blockedRows ?? 0
  const appliedRows = selectedBatch?.appliedRows ?? 0
  const excludedRows = selectedBatch?.excludedRows ?? 0
  const templates = [
    ...DEFAULT_ORDER_IMPORT_TEMPLATES
      .filter((template) => template.id === 'default:sabangnet-sales-confirmation')
      .map((template) => ({ id: template.id, label: `[기본] ${template.name}` })),
    ...customTemplates,
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold">출고반영</h1>
          <p className="text-sm text-muted-foreground">
            사방넷 검수 파일의 출고완료 행을 주문 단계 없이 재고와 매출에 바로 반영합니다.
          </p>
        </div>
        <Link href="/inventory" className="w-fit rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-muted">재고관리로</Link>
      </div>

      <OutboundReflectionActions
        marketplaces={marketplaces}
        templates={templates}
        selectedBatchId={selectedBatchId}
        readyRows={readyRows}
        appliedRows={appliedRows}
        applyInventory={selectedBatch?.applyInventory ?? true}
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <SummaryCard label="전체" value={totalRows} icon="total" />
        <SummaryCard label="반영 대기" value={readyRows} icon="ready" />
        <SummaryCard label="확인 필요" value={blockedRows} icon="blocked" />
        <SummaryCard label="반영 완료" value={appliedRows} icon="applied" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <OutboundReflectionBatchList
          batches={batches.map((batch) => ({
            id: batch.id,
            sourceFileName: batch.sourceFileName,
            applyInventory: batch.applyInventory,
            totalRows: batch.totalRows,
            readyRows: batch.readyRows,
            blockedRows: batch.blockedRows,
            appliedRows: batch.appliedRows,
            excludedRows: batch.excludedRows,
            createdAt: batch.createdAt.toISOString(),
          }))}
          selectedBatchId={selectedBatchId}
          selectedStatus={selectedStatus}
        />
        <div className="space-y-3">
          <StatusFilter
            batchId={selectedBatchId}
            selectedStatus={selectedStatus}
            counts={{ all: totalRows, ready: readyRows, blocked: blockedRows, applied: appliedRows, excluded: excludedRows }}
          />
          <OutboundLineTable lines={lines} />
        </div>
      </div>
    </div>
  )
}

function parseStatus(value: string | undefined): OutboundReflectionStatus | 'all' {
  return value === 'ready' || value === 'blocked' || value === 'applied' || value === 'excluded' ? value : 'all'
}

function SummaryCard({ label, value, icon }: { label: string; value: number; icon: 'total' | 'ready' | 'blocked' | 'applied' }) {
  const Icon = icon === 'blocked' ? AlertTriangle : icon === 'applied' ? CheckCircle2 : icon === 'ready' ? CircleDashed : FileSpreadsheet
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className={`size-4 ${icon === 'blocked' ? 'text-amber-600' : icon === 'applied' ? 'text-emerald-600' : ''}`} />
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value.toLocaleString('ko-KR')}건</div>
    </div>
  )
}

function StatusFilter({
  batchId,
  selectedStatus,
  counts,
}: {
  batchId?: string
  selectedStatus: OutboundReflectionStatus | 'all'
  counts: Record<OutboundReflectionStatus | 'all', number>
}) {
  const filters: Array<{ status: OutboundReflectionStatus | 'all'; label: string }> = [
    { status: 'all', label: '전체' },
    { status: 'ready', label: '반영 대기' },
    { status: 'blocked', label: '확인 필요' },
    { status: 'applied', label: '반영 완료' },
    { status: 'excluded', label: '제외' },
  ]
  return (
    <div className="flex flex-wrap gap-2 rounded-lg border bg-card p-3">
      {filters.map((filter) => (
        <Link
          key={filter.status}
          href={reflectionHref(batchId, filter.status)}
          className={`rounded-md border px-3 py-1.5 text-sm font-medium ${selectedStatus === filter.status ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}
        >
          {filter.label} {counts[filter.status].toLocaleString('ko-KR')}
        </Link>
      ))}
    </div>
  )
}

function reflectionHref(batchId: string | undefined, status: OutboundReflectionStatus | 'all') {
  const params = new URLSearchParams()
  if (batchId) params.set('batch', batchId)
  if (status !== 'all') params.set('status', status)
  const query = params.toString()
  return query ? `/outbound-reflection?${query}` : '/outbound-reflection'
}

function OutboundLineTable({ lines }: { lines: OutboundReflectionLine[] }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="border-b px-4 py-3">
        <h2 className="text-base font-semibold">출고반영 결과</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">확인 필요 행은 SKU와 수량을 수정해 반영 대기로 바꾼 뒤 실행하세요.</p>
      </div>
      {lines.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">표시할 출고 행이 없습니다.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[1080px] w-full text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">출고일</th>
                <th className="px-3 py-2 text-left font-medium">사방넷 주문번호</th>
                <th className="px-3 py-2 text-left font-medium">마켓</th>
                <th className="px-3 py-2 text-left font-medium">상품</th>
                <th className="px-3 py-2 text-right font-medium">수량</th>
                <th className="px-3 py-2 text-right font-medium">매출</th>
                <th className="px-3 py-2 text-left font-medium">구분</th>
                <th className="px-3 py-2 text-left font-medium">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {lines.map((line) => (
                <LineRow key={line.id} line={line} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function LineRow({ line }: { line: OutboundReflectionLine }) {
  const issues = line.issueMessages.join(' ')
  return (
    <>
      <tr className={line.reflectionStatus === 'blocked' ? 'bg-amber-50/70' : line.reflectionStatus === 'excluded' ? 'bg-muted/40 text-muted-foreground' : ''}>
        <td className="px-3 py-3 align-top whitespace-nowrap tabular-nums">{line.shipmentDate}</td>
        <td className="px-3 py-3 align-top font-mono text-xs">{line.sourceOrderNumber}</td>
        <td className="px-3 py-3 align-top">{line.marketplaceName || '-'}</td>
        <td className="px-3 py-3 align-top">
          <div className="font-medium">{line.productName || '상품명 없음'}</div>
          <div className="mt-0.5 font-mono text-xs text-muted-foreground">{line.sku || 'SKU 미매칭'}{line.optionText ? ` · ${line.optionText}` : ''}</div>
        </td>
        <td className="px-3 py-3 text-right align-top tabular-nums">{line.quantity.toLocaleString('ko-KR')}</td>
        <td className="px-3 py-3 text-right align-top tabular-nums">{line.salesAmount.toLocaleString('ko-KR')}원</td>
        <td className="px-3 py-3 align-top">{claimLabel(line.claimType)}</td>
        <td className="px-3 py-3 align-top">
          <StatusBadge status={line.reflectionStatus} />
          {issues ? <div className="mt-1 max-w-56 text-xs leading-5 text-amber-700">{issues}</div> : null}
        </td>
      </tr>
      {line.reflectionStatus === 'blocked' ? (
        <tr className="bg-amber-50/40">
          <td colSpan={8} className="px-3 pb-3 pt-0"><OutboundReflectionLineEdit line={line} /></td>
        </tr>
      ) : null}
    </>
  )
}

function StatusBadge({ status }: { status: OutboundReflectionStatus }) {
  const label = status === 'ready' ? '반영 대기' : status === 'blocked' ? '확인 필요' : status === 'applied' ? '반영 완료' : '제외'
  const className = status === 'ready'
    ? 'border-blue-200 bg-blue-50 text-blue-700'
    : status === 'blocked'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : status === 'applied'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : 'border-border bg-muted text-muted-foreground'
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>{label}</span>
}

function claimLabel(claimType: OutboundReflectionLine['claimType']) {
  if (claimType === 'return') return '반품입고'
  if (claimType === 'exchange') return '교환출고'
  if (claimType === 'cancel') return '취소'
  return '출고'
}
