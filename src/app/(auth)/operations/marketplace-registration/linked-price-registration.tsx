import Link from 'next/link'
import { and, eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { db } from '@/lib/db'
import { analyticsPriceTableRows } from '@/lib/db/schema'
import { getPriceRegistrationFees } from '@/lib/analytics/price-registration-fees'
import { getCommonPrice, getRegistrationMargin, marketplaceFeeId, priceAmount } from '@/lib/analytics/price-registration-values'
import { getRegistrationSourceData } from '@/lib/operations/registration-source-data'
import { PURCHASE_REQUEST_STATUS_LABELS } from '@/lib/purchasing/purchase-request-status'
import { findMarketplaceProductIds, getRegistrationTargets } from '../../analytics/price-table/price-table-columns'
import { getPriceNumberDate, formatPriceNumberDate } from '@/lib/analytics/price-number-date'
import { priceRegistrationHref, priceTableHref, type PriceTableNavigation } from '../../analytics/price-table/price-table-navigation'
import { LinkedPriceRegistrationForm } from './linked-price-registration-form'

export async function LinkedPriceRegistration({ userId, rowId, mallId, search, view, malls, embedded = false, listPage }: {
  embedded?: boolean
  listPage?: number
  userId: string
  rowId: string
  mallId?: string
  search: string
  view: PriceTableNavigation['view']
  malls: string[]
}) {
  if (!z.string().uuid().safeParse(rowId).success) notFound()
  const table = analyticsPriceTableRows
  const [row] = await db.select().from(table).where(and(eq(table.id, rowId), eq(table.userId, userId)))
  if (!row) notFound()
  const targets = getRegistrationTargets(row.sourceSheetName, [])
  const rawData = row.rawData as Record<string, string>
  const registered = targets.flatMap((target) => {
    const numbers = findMarketplaceProductIds(rawData, target)
    return numbers.length ? [{ target, numbers }] : []
  })
  const selected = targets.find((target) => target.id === mallId) ?? registered[0]?.target ?? targets[0]
  if (!selected) notFound()
  const navigation: PriceTableNavigation = {
    sheetName: row.sourceSheetName, search, view, malls, registrationPage: listPage, sortKey: 'createdAt', sortOrder: 'desc',
  }
  const [fees, sources] = await Promise.all([
    getPriceRegistrationFees(userId),
    row.productCode ? getRegistrationSourceData(userId, row.productCode) : null,
  ])
  const item = sources?.item
  const workflow = sources?.workflow
  const purchase = sources?.purchase
  const cost = priceAmount(item?.cost) ?? priceAmount(rawData['원가']) ?? priceAmount(rawData['0.3 원가'])
  const raw = { ...rawData }
  if (cost !== null) raw['원가'] = String(cost)
  const purchaseUrl = sources?.purchaseUrl || workflow?.purchaseUrl
  const detailUrl = workflow?.url
  const registeredName = workflow?.name || row.registeredProductName || item?.name || row.productName
  const fee = fees[marketplaceFeeId(selected.id)]
  const number = findMarketplaceProductIds(raw, selected)[0]?.value
  const form = (
    <>
      <section aria-label="상품 업무 정보" className="space-y-2 rounded-md border bg-card p-3 text-sm">
        <h2 className="font-semibold">상품 업무 정보</h2>
        <dl className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
          <div><dt className="text-muted-foreground">등록 상품명</dt><dd>{registeredName || '–'}</dd></div>
          <div><dt className="text-muted-foreground">옵션</dt><dd>{row.optionName || workflow?.option || '–'}</dd></div>
          <div><dt className="text-muted-foreground">원가</dt><dd>{cost === null ? '미입력' : `${cost.toLocaleString('ko-KR')}원`}</dd></div>
          <div><dt className="text-muted-foreground">최근 발주</dt><dd>{purchase ? [
            PURCHASE_REQUEST_STATUS_LABELS[purchase.status], purchase.requestDate,
            purchase.managementCode || purchase.supplierOrderNumber,
          ].filter(Boolean).join(' · ') : '연결된 발주 없음'}</dd></div>
          {purchase && <div><dt className="text-muted-foreground">발주 수량</dt><dd>{[
            `요청 ${purchase.requestedQuantity}`,
            purchase.actualQuantity == null ? null : `구매 ${purchase.actualQuantity}`,
            purchase.receivedQuantity == null ? null : `입고 ${purchase.receivedQuantity}`,
          ].filter(Boolean).join(' · ')}</dd></div>}
        </dl>
        <div className="flex flex-wrap gap-3 text-xs text-primary">
          {purchaseUrl && /^https?:\/\//i.test(purchaseUrl) && <a href={purchaseUrl} target="_blank" rel="noreferrer" className="underline">구매 URL 열기</a>}
          {detailUrl && /^https?:\/\//i.test(detailUrl) && <a href={detailUrl} target="_blank" rel="noreferrer" className="underline">상세페이지 열기</a>}
          {workflow && <Link href={`/new-products?item=${encodeURIComponent(workflow.id)}`} className="underline">상품관리 열기</Link>}
        </div>
      </section>
      <section aria-label="등록된 몰" className="space-y-2">
        <h2 className="text-sm font-semibold">등록된 몰</h2>
        {registered.length ? (
          <ul className="divide-y rounded-md border bg-card">
            {registered.map(({ target, numbers }) => (
              <li key={target.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <div>
                  <span className="font-medium">{target.label}</span>
                  {numbers.map(({ key, value }) => {
                    const date = getPriceNumberDate(rawData, key)
                      ?? (row.sourceFileName === '직접 등록' ? formatPriceNumberDate(row.importedAt) : null)
                    return <div key={key} className="text-xs text-muted-foreground">{value}{date && ` · ${date}`}</div>
                  })}
                </div>
                <Link href={priceRegistrationHref(row.id, target.id, navigation)} prefetch={false}
                  aria-current={selected.id === target.id ? 'true' : undefined}
                  aria-label={`${target.label} 상품번호 수정`}
                  className="rounded border px-2 py-1 text-xs text-primary hover:bg-muted">번호 수정</Link>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-muted-foreground">저장된 상품등록번호가 없습니다.</p>}
      </section>
      <LinkedPriceRegistrationForm key={selected.id} rowId={row.id} updatedAt={row.updatedAt.toISOString()} navigation={navigation}
      mall={selected.id} targets={targets.map(({ id, label }) => ({ id, label }))}
      commonPrice={getCommonPrice(raw)} number={number}
      amounts={getRegistrationMargin(raw, selected.id, fee)} fee={fee} defaultShipping={priceAmount(item?.shipping)} />
    </>
  )

  return (
    <div className="space-y-4">
      {!embedded && <Link className="text-sm text-primary underline" href={priceTableHref(navigation)}>판매가 테이블로</Link>}
      <header>
        <h2 className="text-base font-semibold">{row.registeredProductName || row.productName || row.productCode}</h2>
        <p className="text-sm text-muted-foreground">{[row.productCode, row.optionName].filter(Boolean).join(' · ')}</p>
      </header>
      <div className="max-w-3xl space-y-3">
        {!embedded && <Link className="text-sm text-primary underline" href="/operations/marketplace-registration">상품등록 목록</Link>}

        {form}
      </div>
    </div>
  )
}
