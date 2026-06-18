import type { Metadata } from 'next'
import Link from 'next/link'
import { Fragment } from 'react'
import { AlertTriangle, CheckCircle2, CircleDashed, FileWarning } from 'lucide-react'
import { and, eq } from 'drizzle-orm'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { db } from '@/lib/db'
import { excelImportTemplates, marketplaceConnections } from '@/lib/db/schema'
import { DEFAULT_ORDER_IMPORT_TEMPLATES } from '@/lib/orders/default-import-templates'
import {
  getSabangnetReviewLines,
  listSabangnetReviewBatches,
  type SabangnetReviewLine,
  type SabangnetReviewStatus,
} from '@/lib/analytics/sabangnet-review'
import { SabangnetReviewActions } from './sabangnet-review-actions'
import { SabangnetReviewLineEdit } from './sabangnet-review-line-edit'

export const metadata: Metadata = {
  title: '사방넷 주문 검수',
}

export default async function SabangnetReviewPage({
  searchParams,
}: {
  searchParams?: Promise<{ batch?: string; status?: string }>
}) {
  const user = await getCurrentUser()
  if (!user) return null

  const params = await searchParams
  const workspaceUserId = await getWorkspaceUserId(user.id)
  const selectedStatus = parseReviewStatus(params?.status)

  const [batches, marketplaces, customTemplates] = await Promise.all([
    listSabangnetReviewBatches(workspaceUserId).catch((error) => {
      console.error('sabangnet review batches error:', error)
      return []
    }),
    db
      .select({
        id: marketplaceConnections.marketplaceId,
        label: marketplaceConnections.displayName,
      })
      .from(marketplaceConnections)
      .where(and(eq(marketplaceConnections.userId, workspaceUserId)))
      .orderBy(marketplaceConnections.displayName)
      .catch((error) => {
        console.error('marketplace list error:', error)
        return []
      }),
    db
      .select({
        id: excelImportTemplates.id,
        label: excelImportTemplates.name,
      })
      .from(excelImportTemplates)
      .where(eq(excelImportTemplates.userId, workspaceUserId))
      .orderBy(excelImportTemplates.name)
      .catch((error) => {
        console.error('import template list error:', error)
        return []
      }),
  ])

  const selectedBatchId = params?.batch ?? batches[0]?.id
  const lines = selectedBatchId
    ? await getSabangnetReviewLines(workspaceUserId, selectedBatchId).catch((error) => {
      console.error('sabangnet review lines error:', error)
      return []
    })
    : []
  const visibleLines = selectedStatus === 'all' ? lines : lines.filter((line) => line.reviewStatus === selectedStatus)
  const selectedBatch = batches.find((batch) => batch.id === selectedBatchId)
  const readyRows = selectedBatch?.readyRows ?? lines.filter((line) => line.reviewStatus === 'ready').length
  const blockedRows = selectedBatch?.blockedRows ?? lines.filter((line) => line.reviewStatus === 'blocked').length
  const confirmedRows = selectedBatch?.confirmedRows ?? lines.filter((line) => line.reviewStatus === 'confirmed').length

  const templates = [
    ...DEFAULT_ORDER_IMPORT_TEMPLATES.map((template) => ({ id: template.id, label: `[기본] ${template.name}` })),
    ...customTemplates,
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold">사방넷 주문 검수</h1>
          <p className="text-sm text-muted-foreground">
            사방넷 주문 파일을 업로드한 뒤 보류건을 검수하고, 정상 주문만 주문관리와 매출분석에 확정 반영합니다.
          </p>
        </div>
        <Link href="/analytics" className="w-fit rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-muted">
          매출분석으로
        </Link>
      </div>

      <SabangnetReviewActions
        marketplaces={marketplaces}
        templates={templates}
        selectedBatchId={selectedBatchId}
        readyRows={readyRows}
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <SummaryCard label="전체" value={selectedBatch?.totalRows ?? lines.length} icon="total" />
        <SummaryCard label="정상" value={readyRows} icon="ready" />
        <SummaryCard label="보류" value={blockedRows} icon="blocked" />
        <SummaryCard label="확정 반영" value={confirmedRows} icon="confirmed" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <BatchList batches={batches} selectedBatchId={selectedBatchId} selectedStatus={selectedStatus} />
        <div className="space-y-3">
          <StatusFilter
            batchId={selectedBatchId}
            selectedStatus={selectedStatus}
            counts={{
              all: selectedBatch?.totalRows ?? lines.length,
              blocked: blockedRows,
              ready: readyRows,
              confirmed: confirmedRows,
            }}
          />
          <ReviewLineTable lines={visibleLines} marketplaces={marketplaces} />
        </div>
      </div>
    </div>
  )
}

function parseReviewStatus(value: string | undefined): SabangnetReviewStatus | 'all' {
  if (value === 'blocked' || value === 'ready' || value === 'confirmed') return value
  return 'all'
}

function SummaryCard({ label, value, icon }: { label: string; value: number; icon: 'total' | 'ready' | 'blocked' | 'confirmed' }) {
  const Icon = icon === 'blocked' ? AlertTriangle : icon === 'confirmed' ? CheckCircle2 : icon === 'ready' ? CircleDashed : FileWarning
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className={`size-4 ${icon === 'blocked' ? 'text-amber-600' : icon === 'confirmed' ? 'text-emerald-600' : ''}`} />
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value.toLocaleString('ko-KR')}건</div>
    </div>
  )
}

function BatchList({
  batches,
  selectedBatchId,
  selectedStatus,
}: {
  batches: Array<{ id: string; sourceFileName: string; totalRows: number; readyRows: number; blockedRows: number; confirmedRows: number; createdAt: Date }>
  selectedBatchId?: string
  selectedStatus: SabangnetReviewStatus | 'all'
}) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b px-4 py-3">
        <h2 className="text-base font-semibold">검수 파일</h2>
      </div>
      <div className="divide-y">
        {batches.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">등록된 검수 파일이 없습니다.</div>
        ) : (
          batches.map((batch) => (
            <Link
              key={batch.id}
              href={`/analytics/sabangnet-review?batch=${batch.id}${selectedStatus === 'all' ? '' : `&status=${selectedStatus}`}`}
              className={[
                'block px-4 py-3 text-sm hover:bg-muted',
                selectedBatchId === batch.id ? 'bg-muted/70' : '',
              ].join(' ')}
            >
              <div className="truncate font-medium" title={batch.sourceFileName}>{batch.sourceFileName}</div>
              <div className="mt-1 text-xs text-muted-foreground">{batch.createdAt.toLocaleString('ko-KR')}</div>
              <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
                <Badge>전체 {batch.totalRows}</Badge>
                <Badge tone="ok">정상 {batch.readyRows}</Badge>
                <Badge tone="warn">보류 {batch.blockedRows}</Badge>
                <Badge tone="done">확정 {batch.confirmedRows}</Badge>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  )
}

function StatusFilter({
  batchId,
  selectedStatus,
  counts,
}: {
  batchId?: string
  selectedStatus: SabangnetReviewStatus | 'all'
  counts: { all: number; blocked: number; ready: number; confirmed: number }
}) {
  const filters: Array<{ status: SabangnetReviewStatus | 'all'; label: string; count: number }> = [
    { status: 'all', label: '전체', count: counts.all },
    { status: 'blocked', label: '보류건', count: counts.blocked },
    { status: 'ready', label: '정상', count: counts.ready },
    { status: 'confirmed', label: '확정', count: counts.confirmed },
  ]

  return (
    <div className="flex flex-wrap gap-2 rounded-lg border bg-card p-3">
      {filters.map((filter) => (
        <Link
          key={filter.status}
          href={reviewHref(batchId, filter.status)}
          className={[
            'rounded-md border px-3 py-1.5 text-sm font-medium',
            selectedStatus === filter.status ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted',
          ].join(' ')}
        >
          {filter.label} {filter.count.toLocaleString('ko-KR')}
        </Link>
      ))}
    </div>
  )
}

function reviewHref(batchId: string | undefined, status: SabangnetReviewStatus | 'all') {
  const params = new URLSearchParams()
  if (batchId) params.set('batch', batchId)
  if (status !== 'all') params.set('status', status)
  const query = params.toString()
  return query ? `/analytics/sabangnet-review?${query}` : '/analytics/sabangnet-review'
}

function ReviewLineTable({
  lines,
  marketplaces,
}: {
  lines: SabangnetReviewLine[]
  marketplaces: Array<{ id: string; label: string }>
}) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b px-4 py-3">
        <h2 className="text-base font-semibold">주문 검수 결과</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          보류건은 아래 수정 영역에서 마켓, SKU, 수량, 금액, 배송비를 수정하면 바로 다시 검수됩니다.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1360px] text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <Th>행</Th>
              <Th>사방넷 주문번호</Th>
              <Th>쇼핑몰 주문번호</Th>
              <Th>신규/기존</Th>
              <Th>중복</Th>
              <Th>마켓</Th>
              <Th>SKU</Th>
              <Th align="right">수량</Th>
              <Th align="right">금액</Th>
              <Th align="right">배송비</Th>
              <Th>클레임</Th>
              <Th>상태</Th>
              <Th>문제 사유</Th>
              <Th>수정</Th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td className="px-3 py-10 text-center text-muted-foreground" colSpan={14}>
                  선택한 조건의 검수 결과가 없습니다.
                </td>
              </tr>
            ) : (
              lines.map((line) => (
                <Fragment key={line.id}>
                  <tr className="border-t align-top">
                    <td className="px-3 py-2 text-muted-foreground">{line.rowNumber}</td>
                    <td className="px-3 py-2 font-medium">{line.sabangnetOrderNumber || line.orderNumber}</td>
                    <td className="px-3 py-2 font-mono text-xs">{line.marketplaceOrderNumber || '-'}</td>
                    <td className="px-3 py-2">{line.existingOrder ? <Badge tone="warn">기존</Badge> : <Badge tone="ok">신규</Badge>}</td>
                    <td className="px-3 py-2">{line.duplicateInFile ? <Badge tone="warn">중복</Badge> : '-'}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{line.marketplaceMatched ? '매칭' : '미매칭'}</div>
                      <div className="max-w-[160px] truncate text-xs text-muted-foreground" title={line.marketplaceName ?? ''}>
                        {line.marketplaceName || line.marketplaceId || '-'}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className={line.skuMatched ? 'font-mono text-emerald-700' : 'font-mono text-amber-700'}>{line.sku || '-'}</div>
                    </td>
                    <Td>{line.quantity.toLocaleString('ko-KR')}</Td>
                    <Td>{formatWon(line.totalAmount)}</Td>
                    <Td>{line.shippingFee == null ? '-' : formatWon(line.shippingFee)}</Td>
                    <td className="px-3 py-2">{line.claimType ? <Badge tone="warn">{claimLabel(line.claimType)}</Badge> : '-'}</td>
                    <td className="px-3 py-2">{statusBadge(line.reviewStatus)}</td>
                    <td className="px-3 py-2">
                      {line.issueMessages.length === 0 ? (
                        <span className="text-emerald-700">문제 없음</span>
                      ) : (
                        <div className="flex max-w-[320px] flex-wrap gap-1">
                          {line.issueMessages.map((message) => <Badge key={message} tone="warn">{message}</Badge>)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {line.reviewStatus === 'confirmed' ? '-' : '아래에서 수정'}
                    </td>
                  </tr>
                  {line.reviewStatus !== 'confirmed' ? (
                    <tr className="border-t bg-muted/10">
                      <td colSpan={14} className="px-3 py-2">
                        <SabangnetReviewLineEdit line={line} marketplaces={marketplaces} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function statusBadge(status: SabangnetReviewLine['reviewStatus']) {
  if (status === 'confirmed') return <Badge tone="done">확정</Badge>
  if (status === 'ready') return <Badge tone="ok">정상</Badge>
  return <Badge tone="warn">보류</Badge>
}

function claimLabel(value: string) {
  if (value === 'cancel') return '취소'
  if (value === 'return') return '반품'
  if (value === 'exchange') return '교환'
  return value
}

function Badge({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'ok' | 'warn' | 'done' }) {
  const className = {
    default: 'border-border bg-background text-muted-foreground',
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    warn: 'border-amber-200 bg-amber-50 text-amber-800',
    done: 'border-blue-200 bg-blue-50 text-blue-700',
  }[tone]
  return <span className={`inline-flex rounded border px-1.5 py-0.5 text-xs font-medium ${className}`}>{children}</span>
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={`px-3 py-2 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}>{children}</th>
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 text-right tabular-nums">{children}</td>
}

function formatWon(value: number) {
  return `${Math.round(value).toLocaleString('ko-KR')}원`
}
