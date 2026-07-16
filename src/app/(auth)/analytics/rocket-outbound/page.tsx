import type { Metadata } from 'next'
import Link from 'next/link'
import { FileSpreadsheet, PackageCheck, TriangleAlert } from 'lucide-react'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import {
  listCoupangRocketOutboundBatches,
  type CoupangRocketOutboundBatch,
} from '@/lib/analytics/coupang-rocket-outbound'
import { getCurrentUser } from '@/lib/auth/current-user'
import { RocketOutboundActions } from './rocket-outbound-actions'

export const metadata: Metadata = {
  title: '로켓배송 출고',
}

export default async function RocketOutboundPage() {
  const user = await getCurrentUser()
  if (!user) return null

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const batches = await listCoupangRocketOutboundBatches(workspaceUserId).catch((error) => {
    console.error('coupang rocket outbound batches error:', error)
    return []
  })
  const latest = batches[0]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold">로켓배송 출고</h1>
          <p className="text-sm text-muted-foreground">
            쿠팡 로켓배송 출고분을 별도 원천으로 보관하고, 품목별 출고수량과 발주검토에 합산합니다.
          </p>
        </div>
        <Link href="/analytics" className="w-fit rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-muted">
          매출분석으로
        </Link>
      </div>

      <RocketOutboundActions />

      <div className="grid gap-3 sm:grid-cols-4">
        <SummaryCard label="등록 파일" value={batches.length} unit="개" icon="files" />
        <SummaryCard label="최근 유효 행" value={latest?.validRows ?? 0} icon="valid" />
        <SummaryCard label="최근 품목 매칭" value={latest?.matchedRows ?? 0} icon="matched" />
        <SummaryCard label="최근 미매칭" value={latest?.unmatchedRows ?? 0} icon="unmatched" />
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="text-base font-semibold">등록 이력</h2>
        </div>
        {batches.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">등록된 로켓배송 출고 파일이 없습니다.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">파일</th>
                  <th className="px-4 py-2 text-left font-medium">출고 기간</th>
                  <th className="px-4 py-2 text-right font-medium">전체</th>
                  <th className="px-4 py-2 text-right font-medium">유효</th>
                  <th className="px-4 py-2 text-right font-medium">품목 매칭</th>
                  <th className="px-4 py-2 text-right font-medium">미매칭</th>
                  <th className="px-4 py-2 text-right font-medium">제외</th>
                  <th className="px-4 py-2 text-left font-medium">등록일</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {batches.map((batch) => <BatchRow key={batch.id} batch={batch} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  unit = '행',
  icon,
}: {
  label: string
  value: number
  unit?: string
  icon: 'files' | 'valid' | 'matched' | 'unmatched'
}) {
  const Icon = icon === 'unmatched' ? TriangleAlert : icon === 'files' ? FileSpreadsheet : PackageCheck
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className={`size-4 ${icon === 'unmatched' ? 'text-amber-600' : ''}`} />
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value.toLocaleString('ko-KR')}{unit}</div>
    </div>
  )
}

function BatchRow({ batch }: { batch: CoupangRocketOutboundBatch }) {
  const excludedRows = batch.invalidRows + batch.duplicateRows
  return (
    <tr>
      <td className="max-w-[280px] truncate px-4 py-3 font-medium" title={batch.sourceFileName}>{batch.sourceFileName}</td>
      <td className="whitespace-nowrap px-4 py-3">{formatPeriod(batch.periodStart, batch.periodEnd)}</td>
      <td className="px-4 py-3 text-right tabular-nums">{batch.totalRows.toLocaleString('ko-KR')}</td>
      <td className="px-4 py-3 text-right tabular-nums">{batch.validRows.toLocaleString('ko-KR')}</td>
      <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{batch.matchedRows.toLocaleString('ko-KR')}</td>
      <td className="px-4 py-3 text-right tabular-nums text-amber-700">{batch.unmatchedRows.toLocaleString('ko-KR')}</td>
      <td className="px-4 py-3 text-right tabular-nums">{excludedRows.toLocaleString('ko-KR')}</td>
      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{batch.createdAt.toLocaleString('ko-KR')}</td>
    </tr>
  )
}

function formatPeriod(start: string | null, end: string | null) {
  if (!start) return '-'
  return start === end || !end ? start : `${start} ~ ${end}`
}
