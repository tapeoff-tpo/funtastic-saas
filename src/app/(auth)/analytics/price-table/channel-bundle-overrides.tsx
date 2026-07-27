import Link from 'next/link'
import { AlertTriangle, CheckCircle2, PackageCheck } from 'lucide-react'
import type { ChannelBundleOverride } from '@/lib/analytics/channel-product-overrides'

export function ChannelBundleOverrides({ rows, search }: { rows: ChannelBundleOverride[]; search: string }) {
  return (
    <section className="overflow-hidden rounded-md border bg-card">
      <div className="flex flex-col gap-1 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <PackageCheck className="size-4 text-emerald-600" />
          <h2 className="text-sm font-semibold">채널 묶음상품 오버라이드</h2>
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">오늘의집 {rows.length}개</span>
        </div>
        <p className="text-xs text-muted-foreground">원본 판매가 엑셀과 별도 저장되어 파일 교체 후에도 유지됩니다.</p>
      </div>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1320px] text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">채널 / 상품 ID</th>
                <th className="min-w-[250px] px-3 py-2 font-medium">묶음상품</th>
                <th className="min-w-[180px] px-3 py-2 font-medium">원본 SKU / 구성</th>
                <th className="px-3 py-2 text-right font-medium">판매가</th>
                <th className="px-3 py-2 text-right font-medium">정상가</th>
                <th className="px-3 py-2 text-right font-medium">배송 / 수수료</th>
                <th className="min-w-[190px] px-3 py-2 font-medium">실재고 기준</th>
                <th className="min-w-[230px] px-3 py-2 font-medium">손익 검증</th>
                <th className="min-w-[140px] px-3 py-2 font-medium">판매 상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => <BundleRow key={row.id} row={row} />)}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-8 text-center text-sm text-muted-foreground">
          {search ? `'${search}'와 일치하는 원본 SKU 또는 묶음상품이 없습니다.` : '등록된 채널 묶음상품이 없습니다.'}
        </div>
      )}
      <div className="border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
        손익 기준: 정산예상액(판매가 + 고객 배송비 - 채널 수수료) - Works 원가 합계 - 최근 실배송비 평균. 보전 기준은 Works 원가 합계와 B2B 기준 판매가 중 큰 값에 실배송비를 더해 계산합니다.
      </div>
    </section>
  )
}

function BundleRow({ row }: { row: ChannelBundleOverride }) {
  const hasWarnings = row.warnings.length > 0
  return (
    <tr className="border-t align-top hover:bg-muted/30">
      <td className="px-3 py-3">
        <div className="font-medium">{row.channelName}</div>
        <div className="font-mono text-xs text-muted-foreground">{row.channelProductId}</div>
      </td>
      <td className="px-3 py-3">
        <div className="font-medium leading-5">{row.productName}</div>
        {row.optionName ? <div className="mt-0.5 text-xs text-muted-foreground">옵션: {row.optionName}</div> : null}
        <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{row.sourceKey}</div>
      </td>
      <td className="px-3 py-3">
        {row.components.map((component) => (
          <Link key={component.sku} href={`/inventory?search=${encodeURIComponent(component.sku)}&searched=1&focusSku=${encodeURIComponent(component.sku)}`} className="block font-mono text-xs text-primary hover:underline">
            {component.sku} x {component.quantity}
          </Link>
        ))}
      </td>
      <td className="px-3 py-3 text-right font-semibold tabular-nums">{money(row.salePrice)}</td>
      <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{money(row.regularPrice)}</td>
      <td className="px-3 py-3 text-right text-xs tabular-nums">
        <div>{row.shippingFee === 0 ? '무료배송' : money(row.shippingFee)}</div>
        <div className="mt-0.5 text-muted-foreground">수수료 {row.commissionRate}% ({money(row.commissionAmount)})</div>
      </td>
      <td className="px-3 py-3 text-xs">
        <div className={`font-medium tabular-nums ${row.hasExcessRegisteredStock ? 'text-red-600' : 'text-emerald-700'}`}>
          실재고 {row.availableBundleStock}세트 / 등록 {row.registeredStock}세트
        </div>
        <div className="mt-0.5 text-muted-foreground">구성 SKU 실재고 ÷ 구성수량의 내림값</div>
      </td>
      <td className="px-3 py-3 text-xs tabular-nums">
        <div>Works 원가 {money(row.componentCost)}</div>
        <div className="mt-0.5">B2B 기준가 {money(row.b2bReferencePrice)}</div>
        <div className="mt-0.5">실배송비 {money(row.actualShippingCost)}</div>
        <div className={`mt-1 font-semibold ${row.estimatedProfit != null && row.estimatedProfit < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
          예상 이익 {money(row.estimatedProfit)}
        </div>
      </td>
      <td className="px-3 py-3 text-xs">
        <span className="inline-flex rounded bg-amber-50 px-2 py-1 font-medium text-amber-700">{row.saleStatus}</span>
        <div className="mt-1 text-muted-foreground">확인 {formatDate(row.lastCheckedAt)}</div>
        {hasWarnings ? (
          <div className="mt-1.5 space-y-1 text-red-600">
            {row.warnings.map((warning) => <div key={warning} className="flex gap-1"><AlertTriangle className="mt-0.5 size-3 shrink-0" />{warning}</div>)}
          </div>
        ) : <div className="mt-1.5 inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="size-3.5" />재고·손익 기준 충족</div>}
      </td>
    </tr>
  )
}

function money(value: number | null) {
  return value == null ? '미확인' : `${Math.round(value).toLocaleString('ko-KR')}원`
}

function formatDate(value: string) {
  return value.replaceAll('-', '.')
}
