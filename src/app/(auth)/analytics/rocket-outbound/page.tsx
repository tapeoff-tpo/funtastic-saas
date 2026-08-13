import type { Metadata } from 'next'
import Link from 'next/link'
import { FileSpreadsheet, PackageCheck, WalletCards } from 'lucide-react'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import {
  channelSalesLabel,
  listChannelSalesBatches,
  type ChannelSalesBatch,
} from '@/lib/analytics/channel-sales'
import { getCurrentUser } from '@/lib/auth/current-user'
import { ChannelSalesActions } from './channel-sales-actions'

export const metadata: Metadata = {
  title: '로켓배송/대량 매출',
}

export default async function RocketOutboundPage() {
  const user = await getCurrentUser()
  if (!user) return null

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const batches = await listChannelSalesBatches(workspaceUserId).catch((error) => {
    console.error('channel sales batches error:', error)
    return []
  })
  const totalSales = batches.reduce((sum, batch) => sum + batch.totalSales, 0)
  const totalProfit = batches.reduce((sum, batch) => sum + (batch.totalProfit ?? 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold">로켓배송/대량 매출</h1>
          <p className="text-sm text-muted-foreground">
            사방넷검수와 별도로 받은 로켓배송·대량 매출 파일을 분석에 반영합니다.
          </p>
        </div>
        <Link href="/analytics" className="w-fit rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-muted">
          매출분석으로
        </Link>
      </div>

      <ChannelSalesActions />

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="등록 파일" value={`${batches.length.toLocaleString('ko-KR')}개`} icon="files" />
        <SummaryCard label="누적 매출" value={formatWon(totalSales)} icon="sales" />
        <SummaryCard label="파일상 누적 마진" value={formatWon(totalProfit)} icon="profit" />
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="text-base font-semibold">등록 이력</h2>
        </div>
        {batches.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">등록된 로켓배송/대량 매출 파일이 없습니다.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">구분</th>
                  <th className="px-4 py-2 text-left font-medium">파일</th>
                  <th className="px-4 py-2 text-left font-medium">매출 반영일</th>
                  <th className="px-4 py-2 text-right font-medium">유효 행</th>
                  <th className="px-4 py-2 text-right font-medium">수량</th>
                  <th className="px-4 py-2 text-right font-medium">매출</th>
                  <th className="px-4 py-2 text-right font-medium">파일상 마진</th>
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

function SummaryCard({ label, value, icon }: { label: string; value: string; icon: 'files' | 'sales' | 'profit' }) {
  const Icon = icon === 'files' ? FileSpreadsheet : icon === 'sales' ? WalletCards : PackageCheck
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="size-4" />
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  )
}

function BatchRow({ batch }: { batch: ChannelSalesBatch }) {
  return (
    <tr>
      <td className="px-4 py-3 font-medium">{channelSalesLabel(batch.channel)}</td>
      <td className="max-w-[280px] truncate px-4 py-3" title={batch.sourceFileName}>{batch.sourceFileName}</td>
      <td className="whitespace-nowrap px-4 py-3">{formatPeriod(batch.periodStart, batch.periodEnd)}</td>
      <td className="px-4 py-3 text-right tabular-nums">{batch.validRows.toLocaleString('ko-KR')}</td>
      <td className="px-4 py-3 text-right tabular-nums">{batch.totalQuantity.toLocaleString('ko-KR')}</td>
      <td className="px-4 py-3 text-right font-medium tabular-nums">{formatWon(batch.totalSales)}</td>
      <td className="px-4 py-3 text-right tabular-nums">{batch.totalProfit == null ? '-' : formatWon(batch.totalProfit)}</td>
      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{new Date(batch.createdAt).toLocaleString('ko-KR')}</td>
    </tr>
  )
}

function formatPeriod(start: string | null, end: string | null) {
  if (!start) return '-'
  return start === end || !end ? start : `${start} ~ ${end}`
}

function formatWon(value: number) {
  return `${Math.round(value).toLocaleString('ko-KR')}원`
}
