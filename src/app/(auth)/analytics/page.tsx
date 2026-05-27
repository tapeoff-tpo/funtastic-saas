import type { Metadata } from 'next'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getActualShippingCostRecentImports } from '@/lib/shipping/actual-costs'
import { ActualShippingCostUpload } from './actual-shipping-cost-upload'

export const metadata: Metadata = {
  title: '매출분석',
}

const carrierLabels: Record<string, string> = {
  CJGLS: 'CJ대한통운',
  KDEXP: '경동택배',
  DAESIN: '대신택배',
}

export default async function AnalyticsPage() {
  const user = await getCurrentUser()
  const recent = user
    ? await getActualShippingCostRecentImports(await getWorkspaceUserId(user.id))
    : []

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">매출분석</h1>
        <p className="text-sm text-muted-foreground">
          매출 계산에 사용할 실제배송비 자료를 먼저 쌓아둡니다.
        </p>
      </div>

      <ActualShippingCostUpload />

      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="text-base font-semibold">최근 반영된 실제배송비</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">택배사</th>
                <th className="px-3 py-2 text-left font-medium">운송장번호</th>
                <th className="px-3 py-2 text-right font-medium">실제배송비</th>
                <th className="px-3 py-2 text-left font-medium">매칭</th>
                <th className="px-3 py-2 text-left font-medium">파일</th>
                <th className="px-3 py-2 text-left font-medium">반영일</th>
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-muted-foreground" colSpan={6}>
                    아직 반영된 실제배송비가 없습니다.
                  </td>
                </tr>
              ) : (
                recent.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="px-3 py-2">{carrierLabels[row.carrierId] ?? row.carrierId}</td>
                    <td className="px-3 py-2 font-mono">{row.trackingNumber}</td>
                    <td className="px-3 py-2 text-right">
                      {Number(row.actualFee).toLocaleString()}원
                    </td>
                    <td className="px-3 py-2">
                      {row.shipmentId ? '매칭됨' : '미매칭'}
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-2">{row.sourceFileName ?? '-'}</td>
                    <td className="px-3 py-2">
                      {new Date(row.importedAt).toLocaleString('ko-KR')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
