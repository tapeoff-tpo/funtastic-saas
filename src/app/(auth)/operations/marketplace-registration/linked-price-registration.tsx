import Link from 'next/link'
import { and, eq, sql } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { db } from '@/lib/db'
import { analyticsPriceTableRows, products } from '@/lib/db/schema'
import { getPriceRegistrationFees } from '@/lib/analytics/price-registration-fees'
import { getCommonPrice, getRegistrationMargin, marketplaceFeeId } from '@/lib/analytics/price-registration-values'
import { ensureMarketplaceRegistrationTables } from '@/lib/operations/marketplace-registration'
import { findMarketplaceProductIds, getRegistrationTargets } from '../../analytics/price-table/price-table-columns'
import { priceTableHref, type PriceTableNavigation } from '../../analytics/price-table/price-table-navigation'
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
  await ensureMarketplaceRegistrationTables()
  const [fees, profiles, [item]] = await Promise.all([
    getPriceRegistrationFees(userId),
    row.productCode ? db.execute<{ url: string | null }>(sql`
      SELECT COALESCE(detail_notice->'linkedWorkflow'->>'detailPageUrl', source_product_url) AS url
      FROM marketplace_registration_profiles
      WHERE user_id = ${userId}::uuid AND (
        product_code = ${row.productCode} OR sales_codes ? ${row.productCode}
      )
      ORDER BY (product_code = ${row.productCode}) DESC, updated_at DESC
      LIMIT 1
    `) : [],
    row.productCode ? db.select({ cost: products.costPrice }).from(products)
      .where(and(eq(products.userId, userId), eq(products.internalSku, row.productCode))).limit(1) : [],
  ])
  const raw = { '원가': item?.cost, ...row.rawData } as Record<string, string>
  const fee = fees[marketplaceFeeId(selected.id)]
  const number = findMarketplaceProductIds(raw, selected)[0]?.value
  const detailUrl = profiles[0]?.url
  return (
    <div className="max-w-3xl space-y-4">
      <Link className="text-sm text-primary underline" href={priceTableHref(navigation)}>판매가 테이블로</Link>
      <header>
        <h1 className="text-xl font-semibold">상품등록</h1>
        <p className="mt-1 font-medium">{row.productName || row.registeredProductName || row.productCode}</p>
        <p className="text-sm text-muted-foreground">{[row.productCode, row.optionName].filter(Boolean).join(' · ')}</p>
        {detailUrl && /^https?:\/\//i.test(detailUrl) && (
          <a href={detailUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm text-primary underline">상세페이지 확인</a>
        )}
      </header>
      <LinkedPriceRegistrationForm key={selected.id} rowId={row.id} updatedAt={row.updatedAt.toISOString()} navigation={navigation}
        mall={selected.id} targets={targets.map(({ id, label }) => ({ id, label }))}
        commonPrice={getCommonPrice(raw)} number={number}
        amounts={getRegistrationMargin(raw, selected.id, fee)} fee={fee} />
    </div>
  )
}
