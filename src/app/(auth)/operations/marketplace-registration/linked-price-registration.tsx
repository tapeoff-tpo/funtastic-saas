import Link from 'next/link'
import { and, eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { db } from '@/lib/db'
import { analyticsPriceTableRows, products } from '@/lib/db/schema'
import { getPriceRegistrationFees } from '@/lib/analytics/price-registration-fees'
import { getCommonPrice, getRegistrationMargin, marketplaceFeeId } from '@/lib/analytics/price-registration-values'
import { listMarketplaceRegistrationProducts } from '@/lib/operations/marketplace-registration'
import { findMarketplaceProductIds, getRegistrationTargets } from '../../analytics/price-table/price-table-columns'
import { priceTableHref, type PriceTableNavigation } from '../../analytics/price-table/price-table-navigation'
import { RegistrationBoard } from './registration-board'
import { LinkedPriceRegistrationForm } from './linked-price-registration-form'

export async function LinkedPriceRegistration({ userId, rowId, mallId, search, view, malls }: {
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
  const selected = targets.find((target) => target.id === mallId) ?? targets[0]
  if (!selected) notFound()
  const navigation: PriceTableNavigation = {
    sheetName: row.sourceSheetName, search, view, malls, sortKey: 'importedAt', sortOrder: 'desc',
  }
  const [fees, profiles, [item]] = await Promise.all([
    getPriceRegistrationFees(userId),
    row.productCode ? listMarketplaceRegistrationProducts(userId, row.productCode) : [],
    row.productCode ? db.select({ cost: products.costPrice }).from(products)
      .where(and(eq(products.userId, userId), eq(products.internalSku, row.productCode))).limit(1) : [],
  ])
  const raw = { '원가': item?.cost, ...row.rawData } as Record<string, string>
  const fee = fees[marketplaceFeeId(selected.id)]
  const number = findMarketplaceProductIds(raw, selected)[0]?.value
  const form = (
    <LinkedPriceRegistrationForm key={selected.id} rowId={row.id} updatedAt={row.updatedAt.toISOString()} navigation={navigation}
      mall={selected.id} targets={targets.map(({ id, label }) => ({ id, label }))}
      commonPrice={getCommonPrice(raw)} number={number}
      amounts={getRegistrationMargin(raw, selected.id, fee)} fee={fee} />
  )

  return (
    <div className="space-y-4">
      <Link className="text-sm text-primary underline" href={priceTableHref(navigation)}>판매가 테이블로</Link>
      <header>
        <h1 className="text-xl font-semibold">상품등록</h1>
        <p className="text-sm text-muted-foreground">{[row.productCode, row.optionName].filter(Boolean).join(' · ')}</p>
      </header>
      {profiles.length > 0
        ? <RegistrationBoard rows={profiles} focusedRegistration={form} />
        : <div className="max-w-3xl space-y-3">
            <p className="font-medium">{row.productName || row.registeredProductName || row.productCode}</p>
            <p className="text-sm text-muted-foreground">연결된 상품등록 정보가 없습니다.</p>
            {row.productCode && (
              <Link className="inline-block text-sm text-primary underline"
                href={`/operations/marketplace-registration?q=${encodeURIComponent(row.productCode)}`}>
                상품등록 목록에서 상품 찾기
              </Link>
            )}
            {form}
          </div>}
    </div>
  )
}
