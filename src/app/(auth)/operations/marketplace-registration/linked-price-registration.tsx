import Link from 'next/link'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { db } from '@/lib/db'
import { analyticsPriceTableRows, products } from '@/lib/db/schema'
import { getPriceRegistrationFees } from '@/lib/analytics/price-registration-fees'
import {
  getMallBasePrice, getRegistrationMargin, marketplaceFeeId, priceAmount,
  registrationNumberActorKey, registrationNumberKey,
} from '@/lib/analytics/price-registration-values'
import { getRegistrationGroupRows, registrationBaseCode, groupRegistrationNumbers, registrationGroupSnapshot } from '@/lib/operations/registration-groups'
import { RegistrationOptionSelector } from './option-selector'
import { getRegistrationSourceData } from '@/lib/operations/registration-source-data'
import { PURCHASE_REQUEST_STATUS_LABELS } from '@/lib/purchasing/purchase-request-status'
import { findMarketplaceProductIds, getManualRegistrationTargets } from '../../analytics/price-table/price-table-columns'
import { getPriceNumberDate, formatPriceNumberDate } from '@/lib/analytics/price-number-date'
import { priceTableHref, type PriceTableNavigation } from '../../analytics/price-table/price-table-navigation'
import { ManualRegistrationPanel, RegistrationCopy } from './manual-registration-panel'

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
  const rows = await getRegistrationGroupRows(userId, rowId)
  const foundRow = rows.find((option) => option.id === rowId)
  if (!foundRow) notFound()
  const baseCode = registrationBaseCode(foundRow.productCode)
  const unique = new Map<string, (typeof rows)[number]>()
  for (const option of rows) {
    const key = option.productCode || option.id
    const previous = unique.get(key)
    if (!previous || previous.updatedAt < option.updatedAt) unique.set(key, option)
  }
  const uniqueRows = [...unique.values()].sort((left, right) =>
    (left.productCode ?? '').localeCompare(right.productCode ?? '', 'ko-KR', { numeric: true }))
  const optionRows = uniqueRows.some((option) => option.productCode !== baseCode)
    ? uniqueRows.filter((option) => option.productCode !== baseCode) : uniqueRows
  const row = optionRows.find((option) => option.id === rowId) ?? optionRows[0] ?? foundRow
  const codes = [...new Set(rows.flatMap((option) => option.productCode ? [option.productCode] : []).concat(baseCode ? [baseCode] : []))]
  const [workflowPrices, itemCosts, fees, sources] = await Promise.all([
    codes.length ?
    db.execute<{ sku: string; b2b: number | null; b2c: number | null }>(sql`
      SELECT DISTINCT ON (sabangnet_code) sabangnet_code AS sku, b2b_price AS b2b, b2c_price AS b2c
      FROM new_product_workflow_items WHERE user_id = ${userId}::uuid
        AND sabangnet_code IN (${sql.join(codes.map((code) => sql`${code}`), sql`, `)})
      ORDER BY sabangnet_code, created_at DESC, id DESC
    `) : Promise.resolve([]),
    codes.length ? db.select({ sku: products.internalSku, cost: products.costPrice }).from(products)
      .where(and(eq(products.userId, userId), inArray(products.internalSku, codes))) : Promise.resolve([]),
    getPriceRegistrationFees(userId),
    row.productCode ? getRegistrationSourceData(userId, row.productCode) : Promise.resolve(null),
  ])
  const pricesBySku = new Map(workflowPrices.map((value) => [value.sku, value]))
  const costsBySku = new Map(itemCosts.map((value) => [value.sku, value.cost]))
  const options = optionRows.map((option) => {
    const raw = { ...option.rawData } as Record<string, string>
    const prices = pricesBySku.get(option.productCode ?? '')
    const parent = pricesBySku.get(baseCode ?? '')
    if (prices?.b2b != null) raw.__productB2BPrice = String(prices.b2b)
    else if (parent?.b2b != null) raw.__parentB2BPrice = String(parent.b2b)
    if (prices?.b2c != null) raw.__productB2CPrice = String(prices.b2c)
    else if (parent?.b2c != null) raw.__parentB2CPrice = String(parent.b2c)
    const itemCost = costsBySku.get(option.productCode ?? '') ?? costsBySku.get(baseCode ?? '')
    if (itemCost != null) raw['원가'] = itemCost
    return { row: option, raw, b2b: priceAmount(prices?.b2b) ?? priceAmount(raw['B2B 판매가']) ?? priceAmount(parent?.b2b),
      b2c: priceAmount(prices?.b2c) ?? priceAmount(raw['B2C 판매가']) ?? priceAmount(parent?.b2c) }
  })
  const navigation: PriceTableNavigation = {
    sheetName: row.sourceSheetName, search, view, malls, registrationPage: listPage, sortKey: 'createdAt', sortOrder: 'desc',
  }
  const item = sources?.item
  const workflow = sources?.workflow
  const purchase = sources?.purchase
  const raw = { ...row.rawData } as Record<string, string>
  const cost = priceAmount(item?.cost) ?? priceAmount(raw['원가']) ?? priceAmount(raw['0.3 원가'])
  if (cost !== null) raw['원가'] = String(cost)
  if (workflow?.b2bPrice != null) raw.__productB2BPrice = String(workflow.b2bPrice)
  if (workflow?.b2cPrice != null) raw.__productB2CPrice = String(workflow.b2cPrice)
  const b2b = options.find((option) => option.row.id === row.id)?.b2b ?? null
  const b2c = options.find((option) => option.row.id === row.id)?.b2c ?? null
  const registeredName = workflow?.name || row.registeredProductName || item?.name || row.productName || row.productCode || ''
  const purchaseUrl = sources?.purchaseUrl || workflow?.purchaseUrl
  const detailUrl = workflow?.url
  const fields = [
    { label: '등록 상품명', value: registeredName },
    { label: '상품코드', value: row.productCode },
    { label: '옵션', value: row.optionName || workflow?.option },
    { label: '선택 옵션 B2B 등록가 (원)', value: b2b === null ? null : String(b2b) },
    { label: '선택 옵션 B2C 등록가 (원)', value: b2c === null ? null : String(b2c) },
    { label: '제조사', value: sources?.manufacturer },
    { label: '제조국', value: sources?.countryOfOrigin },
    { label: '재질', value: sources?.material },
    { label: '제품크기', value: sources?.size },
    { label: '무게', value: sources?.weight },
    { label: '용량', value: sources?.capacity },
    { label: '구성품', value: sources?.components },
    { label: '특이사항', value: sources?.specialNotes },
  ]
  const cards = getManualRegistrationTargets(row.sourceSheetName).map((target) => {
    const fee = fees[marketplaceFeeId(target.id)]
    const optionPrices = options.map((option) => {
      const base = getMallBasePrice(option.raw, target.id, target.valueKey)
      const amounts = getRegistrationMargin({ ...option.raw, '공통 판매가': base }, target.id, fee)
      return {
        rowId: option.row.id, sku: option.row.productCode ?? '', label: option.row.optionName || option.row.productName || '기본 옵션',
        registrationPrice: amounts.price, overridePrice: amounts.override, priceEdited: amounts.override !== null,
        displayedPrice: priceAmount(option.raw['__registrationEdit:displayPrice:' + target.id]),
        displayedDate: option.raw['__registrationEdit:displayDate:' + target.id] ?? null,
      }
    })
    const numbers = groupRegistrationNumbers(rows, target)
    return {
      id: target.id, label: target.label, price: optionPrices[0]?.registrationPrice ?? null,
      priceEdited: optionPrices.some((option) => option.priceEdited), margin: null, fee: fee ?? null,
      groupSnapshot: registrationGroupSnapshot(rows, target), options: optionPrices,
      numbers: numbers.map(({ key, value }) => {
        const source = rows.find((option) => findMarketplaceProductIds(option.rawData as Record<string, string>, target)
          .some((number) => number.key === key && number.value === value)) ?? row
        const data = source.rawData as Record<string, string>
        return {
          key, value,
          date: getPriceNumberDate(data, key) ?? (source.sourceFileName === '직접 등록' ? formatPriceNumberDate(source.importedAt) : null),
          manual: Boolean(data[registrationNumberActorKey(target.id, key)]) || key === registrationNumberKey(target.id),
        }
      }),
    }
  })

  return <div className="space-y-4">
    {!embedded && <Link className="text-sm text-primary underline" href={priceTableHref(navigation)}>판매가 테이블로</Link>}
    <header>
      <h2 className="text-base font-semibold">{registeredName}</h2>
      <p className="text-xs text-muted-foreground">{baseCode} · 옵션 {optionRows.length}개</p>
    </header>
    <RegistrationOptionSelector selected={row.id} options={optionRows.map((option) => ({
      id: option.id, sku: option.productCode ?? '', label: option.optionName ?? '',
    }))} />
    <section aria-label="수동 등록용 상품정보" className="space-y-3 rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">등록용 상품정보</h3>
        <Link href={workflow ? `/new-products?item=${encodeURIComponent(workflow.id)}` : '/new-products'}
          className="text-xs text-primary underline">상품관리 열기</Link>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        {fields.filter((field, index) => index < 7 || field.value).map((field) =>
          <RegistrationCopy key={`${row.id}:${field.label}:${field.value}`} label={field.label} value={field.value} />)}
      </dl>
      <div className="flex flex-wrap gap-3 border-t pt-3 text-xs">
        {purchaseUrl && /^https?:\/\//i.test(purchaseUrl) && <a href={purchaseUrl} target="_blank" rel="noreferrer" className="text-primary underline">구매 URL 열기</a>}
        {detailUrl && /^https?:\/\//i.test(detailUrl) && <a href={detailUrl} target="_blank" rel="noreferrer" className="text-primary underline">상세페이지 열기</a>}
        <Link href={`/costs?search=${encodeURIComponent(row.productCode ?? '')}`} className="text-primary underline">품목·원가</Link>
        <Link href={priceTableHref({ ...navigation, search: row.productCode ?? search })} className="text-primary underline">판매가 테이블</Link>
      </div>
      {detailUrl && <dl><RegistrationCopy key={`${row.id}:${detailUrl}`} label="상세페이지 URL" value={detailUrl} /></dl>}
    </section>
    <ManualRegistrationPanel key={baseCode ?? row.id} rowId={row.id} malls={cards} initialMallId={mallId} />
    <details className="rounded-lg border p-3 text-xs text-muted-foreground">
      <summary className="cursor-pointer">원가·발주 참고</summary>
      <p className="mt-2">원가 {cost === null ? '미입력' : `${cost.toLocaleString('ko-KR')}원`}</p>
      <p className="mt-1">최근 발주 {purchase ? [
        PURCHASE_REQUEST_STATUS_LABELS[purchase.status], purchase.requestDate,
        purchase.managementCode || purchase.supplierOrderNumber,
      ].filter(Boolean).join(' · ') : '연결된 발주 없음'}</p>
      {purchase && <p className="mt-1">요청 {purchase.requestedQuantity}개{purchase.actualQuantity == null ? '' : ` · 구매 ${purchase.actualQuantity}개`}{purchase.receivedQuantity == null ? '' : ` · 입고 ${purchase.receivedQuantity}개`}</p>}
    </details>
  </div>
}
