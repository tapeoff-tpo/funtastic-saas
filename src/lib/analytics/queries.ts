import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

export type AnalyticsGranularity = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'custom'

export type AnalyticsPeriod = {
  granularity: AnalyticsGranularity
  key: string
  label: string
  startDate: string
  endDate: string
  previousStartDate: string
  previousEndDate: string
}

type SummaryRow = { orders: number; gross_sales: string; paid_shipping: string; shipping_value_orders: number; shipping_nonzero_orders: number }
type ChannelRow = { marketplace: string | null; orders: number; sales: string; paid_shipping: string; shipping_value_orders: number }
type ProductRow = { sku: string | null; product_name: string | null; units: number; sales: string; cost_price: string | null; shipping_cost: string | null }
type ProductPerformanceRow = { sku: string | null; product_name: string | null; units: number; current_sales: string; previous_sales: string; cost_price: string | null }
type CoverageRow = { line_count: number; cost_known_lines: number }
type ClaimRow = { type: 'return' | 'exchange' | 'cancel'; status: string; count: number }
type MonthRow = { key: string }
type LatestDateRow = { latest_date: string | null }
type SpecialRow = { marketplace: string | null; orders: number; sales: string }
type ChannelProductDropRow = { marketplace: string | null; sku: string | null; product_name: string | null; current_sales: string; previous_sales: string }
type ChannelProductRiseRow = { marketplace: string | null; sku: string | null; product_name: string | null; current_sales: string; previous_sales: string }
type SlowStockRow = { sku: string; product_name: string; available_stock: number; last_incoming_at: string; sold_since_incoming: number }
type IncomingCoverageRow = { sku_count: number; history_count: number; latest_incoming_at: string | null }

const eligibleStatus = sql`l.reflection_status in ('applied', 'ready')`
const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })

/**
 * The Works import stores its source value in product metadata. `cost_price`
 * is preferred when it has already been normalised, but analytics must retain
 * the imported Works cost until that migration is complete.
 */
function worksCost(tableName: string) {
  const table = sql.raw(tableName)
  const worksNewCost = sql`replace(${table}.metadata->'esa009m'->>'works 신규 원가', ',', '')`
  const registeredCost = sql`replace(${table}.metadata->'costRegistration'->>'cost', ',', '')`
  return sql`coalesce(
    ${table}.cost_price,
    case when ${worksNewCost} ~ '^[0-9]+([.][0-9]+)?$' then ${worksNewCost}::numeric end,
    case when ${registeredCost} ~ '^[0-9]+([.][0-9]+)?$' then ${registeredCost}::numeric end
  )`
}

function asDateString(date: Date) {
  const parts = dateFormatter.formatToParts(date)
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function fromDateString(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function addDays(date: Date, amount: number) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + amount)
  return next
}

function addMonths(date: Date, amount: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1))
}

function formatShort(date: Date) {
  return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' }).format(date)
}

function parseGranularity(value?: string): AnalyticsGranularity {
  return value === 'day' || value === 'week' || value === 'quarter' || value === 'year' || value === 'custom' ? value : 'month'
}

export function getAnalyticsPeriod({ range, date, month, start: requestedStart, end: requestedEnd }: { range?: string; date?: string; month?: string; start?: string; end?: string }): AnalyticsPeriod {
  const granularity = parseGranularity(range)
  const requested = /^\d{4}-\d{2}-\d{2}$/.test(date ?? '')
    ? fromDateString(date!)
    : /^\d{4}-(0[1-9]|1[0-2])$/.test(month ?? '')
      ? fromDateString(`${month}-01`)
      : new Date()

  let start: Date
  let end: Date
  let previousStart: Date
  let previousEnd: Date
  let label: string

  if (granularity === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(requestedStart ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(requestedEnd ?? '') && requestedStart! <= requestedEnd!) {
    start = fromDateString(requestedStart!); end = addDays(fromDateString(requestedEnd!), 1)
    const span = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000))
    previousStart = addDays(start, -span); previousEnd = start
    label = `${formatShort(start)} - ${formatShort(addDays(end, -1))}`
  } else if (granularity === 'day') {
    start = requested; end = addDays(start, 1); previousStart = addDays(start, -1); previousEnd = start
    label = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' }).format(start)
  } else if (granularity === 'week') {
    start = addDays(requested, -((requested.getUTCDay() + 6) % 7)); end = addDays(start, 7); previousStart = addDays(start, -7); previousEnd = start
    label = `${formatShort(start)} - ${formatShort(addDays(end, -1))}`
  } else if (granularity === 'quarter') {
    const quarterMonth = Math.floor(requested.getUTCMonth() / 3) * 3
    start = new Date(Date.UTC(requested.getUTCFullYear(), quarterMonth, 1)); end = addMonths(start, 3); previousStart = addMonths(start, -3); previousEnd = start
    label = `${start.getUTCFullYear()}년 ${Math.floor(quarterMonth / 3) + 1}분기`
  } else if (granularity === 'year') {
    start = new Date(Date.UTC(requested.getUTCFullYear(), 0, 1)); end = new Date(Date.UTC(requested.getUTCFullYear() + 1, 0, 1)); previousStart = new Date(Date.UTC(requested.getUTCFullYear() - 1, 0, 1)); previousEnd = start
    label = `${start.getUTCFullYear()}년`
  } else {
    start = new Date(Date.UTC(requested.getUTCFullYear(), requested.getUTCMonth(), 1)); end = addMonths(start, 1); previousStart = addMonths(start, -1); previousEnd = start
    label = `${start.getUTCFullYear()}년 ${start.getUTCMonth() + 1}월`
  }

  return { granularity, key: asDateString(start), label, startDate: asDateString(start), endDate: asDateString(end), previousStartDate: asDateString(previousStart), previousEndDate: asDateString(previousEnd) }
}

export async function getAvailableAnalyticsMonths(userId: string) {
  const rows = await db.execute(sql`
    select to_char(date_trunc('month', l.shipment_date), 'YYYY-MM') as key
    from outbound_reflection_lines l where l.user_id = ${userId} and ${eligibleStatus} and l.shipment_date is not null
    group by 1 order by 1 desc limit 24
  `) as unknown as MonthRow[]
  return rows.map((row) => row.key)
}

export async function getLatestAnalyticsDate(userId: string) {
  const [row] = await db.execute(sql`
    select max(l.shipment_date)::text as latest_date from outbound_reflection_lines l
    where l.user_id = ${userId} and ${eligibleStatus} and l.shipment_date is not null
  `) as unknown as LatestDateRow[]
  return row?.latest_date ? row.latest_date.slice(0, 10) : null
}

export type SalesAnalytics = Awaited<ReturnType<typeof getSalesAnalytics>>

/** Uses reflected outbound lines; excluded rows are known duplicate reflections. */
export async function getSalesAnalytics(userId: string, period: AnalyticsPeriod) {
  const baseWhere = sql`l.user_id = ${userId} and ${eligibleStatus} and l.claim_type is null and l.shipment_date >= ${period.startDate} and l.shipment_date < ${period.endDate}`
  const previousWhere = sql`l.user_id = ${userId} and ${eligibleStatus} and l.claim_type is null and l.shipment_date >= ${period.previousStartDate} and l.shipment_date < ${period.previousEndDate}`

  const [summaryRows, previousRows, channelRows, productRows, productPerformanceRows, coverageRows, claimRows, specialRows, channelProductDropRows, channelProductRiseRows, slowStockRows, incomingCoverageRows] = await Promise.all([
    db.execute(sql`
      with order_rows as (select coalesce(l.source_order_number, l.source_key) as order_key, coalesce(sum(l.sales_amount), 0) as sales_amount, max(l.shipping_fee) as shipping_fee from outbound_reflection_lines l where ${baseWhere} group by coalesce(l.source_order_number, l.source_key))
      select count(*)::int as orders, coalesce(sum(sales_amount), 0)::text as gross_sales, coalesce(sum(shipping_fee), 0)::text as paid_shipping, count(shipping_fee)::int as shipping_value_orders, count(*) filter (where shipping_fee > 0)::int as shipping_nonzero_orders from order_rows
    `) as unknown as Promise<SummaryRow[]>,
    db.execute(sql`
      with order_rows as (select coalesce(l.source_order_number, l.source_key) as order_key, coalesce(sum(l.sales_amount), 0) as sales_amount from outbound_reflection_lines l where ${previousWhere} group by coalesce(l.source_order_number, l.source_key))
      select count(*)::int as orders, coalesce(sum(sales_amount), 0)::text as gross_sales, '0'::text as paid_shipping, 0::int as shipping_value_orders, 0::int as shipping_nonzero_orders from order_rows
    `) as unknown as Promise<SummaryRow[]>,
    db.execute(sql`
      with order_rows as (select coalesce(nullif(trim(l.marketplace_name), ''), l.marketplace_id, '미분류') as marketplace, coalesce(l.source_order_number, l.source_key) as order_key, coalesce(sum(l.sales_amount), 0) as sales_amount, max(l.shipping_fee) as shipping_fee from outbound_reflection_lines l where ${baseWhere} group by coalesce(nullif(trim(l.marketplace_name), ''), l.marketplace_id, '미분류'), coalesce(l.source_order_number, l.source_key))
      select marketplace, count(*)::int as orders, coalesce(sum(sales_amount), 0)::text as sales, coalesce(sum(shipping_fee), 0)::text as paid_shipping, count(shipping_fee)::int as shipping_value_orders from order_rows group by marketplace order by sum(sales_amount) desc
    `) as unknown as Promise<ChannelRow[]>,
    db.execute(sql`
      select coalesce(l.sku, '미매핑') as sku,
        coalesce(max(direct_product.name), max(variant_product.name), max(l.product_name), '이름 없음') as product_name,
        coalesce(sum(l.quantity), 0)::int as units,
        coalesce(sum(l.sales_amount), 0)::text as sales,
        coalesce(max(${worksCost('direct_product')}), max(${worksCost('variant_product')}))::text as cost_price,
        coalesce(max(direct_product.shipping_cost), max(variant_product.shipping_cost))::text as shipping_cost
      from outbound_reflection_lines l
      left join products direct_product on direct_product.user_id = ${userId} and direct_product.internal_sku = l.sku
      left join product_variants pv on pv.sku = l.sku
      left join products variant_product on variant_product.id = pv.product_id and variant_product.user_id = ${userId}
      where ${baseWhere}
      group by l.sku order by sum(l.sales_amount) desc limit 30
    `) as unknown as Promise<ProductRow[]>,
    db.execute(sql`
      with current_products as (
        select coalesce(l.sku, '미매핑') as sku, max(l.product_name) as product_name, coalesce(sum(l.quantity), 0)::int as units, coalesce(sum(l.sales_amount), 0) as sales
        from outbound_reflection_lines l where ${baseWhere}
        group by 1
      ), previous_products as (
        select coalesce(l.sku, '미매핑') as sku, max(l.product_name) as product_name, coalesce(sum(l.sales_amount), 0) as sales
        from outbound_reflection_lines l where ${previousWhere}
        group by 1
      )
      select coalesce(c.sku, p.sku) as sku,
        coalesce(c.product_name, p.product_name, direct_product.name, variant_product.name, '이름 없음') as product_name,
        coalesce(c.units, 0)::int as units,
        coalesce(c.sales, 0)::text as current_sales,
        coalesce(p.sales, 0)::text as previous_sales,
        coalesce(max(${worksCost('direct_product')}), max(${worksCost('variant_product')}))::text as cost_price
      from current_products c full outer join previous_products p on p.sku = c.sku
      left join products direct_product on direct_product.user_id = ${userId} and direct_product.internal_sku = coalesce(c.sku, p.sku)
      left join product_variants pv on pv.sku = coalesce(c.sku, p.sku)
      left join products variant_product on variant_product.id = pv.product_id and variant_product.user_id = ${userId}
      group by coalesce(c.sku, p.sku), c.product_name, p.product_name, direct_product.name, variant_product.name, c.units, c.sales, p.sales
      order by greatest(coalesce(c.sales, 0), coalesce(p.sales, 0)) desc limit 100
    `) as unknown as Promise<ProductPerformanceRow[]>,
    db.execute(sql`
      select count(*)::int as line_count,
        count(coalesce(${worksCost('direct_product')}, ${worksCost('variant_product')}))::int as cost_known_lines
      from outbound_reflection_lines l
      left join products direct_product on direct_product.user_id = ${userId} and direct_product.internal_sku = l.sku
      left join product_variants pv on pv.sku = l.sku
      left join products variant_product on variant_product.id = pv.product_id and variant_product.user_id = ${userId}
      where ${baseWhere}
    `) as unknown as Promise<CoverageRow[]>,
    db.execute(sql`
      select l.claim_type as type, l.reflection_status as status, count(*)::int as count from outbound_reflection_lines l where l.user_id = ${userId} and ${eligibleStatus} and l.claim_type is not null and l.shipment_date >= ${period.startDate} and l.shipment_date < ${period.endDate} group by l.claim_type, l.reflection_status
    `) as unknown as Promise<ClaimRow[]>,
    db.execute(sql`
      with order_rows as (select coalesce(nullif(trim(l.marketplace_name), ''), l.marketplace_id, '미분류') as marketplace, coalesce(l.source_order_number, l.source_key) as order_key, coalesce(sum(l.sales_amount), 0) as sales_amount from outbound_reflection_lines l where ${baseWhere} group by coalesce(nullif(trim(l.marketplace_name), ''), l.marketplace_id, '미분류'), coalesce(l.source_order_number, l.source_key))
      select marketplace, count(*)::int as orders, coalesce(sum(sales_amount), 0)::text as sales from order_rows where marketplace in ('로켓배송', '대량') group by marketplace
    `) as unknown as Promise<SpecialRow[]>,
    db.execute(sql`
      with current_sales as (
        select coalesce(nullif(trim(l.marketplace_name), ''), l.marketplace_id, '미분류') as marketplace, coalesce(l.sku, '미매핑') as sku, max(l.product_name) as product_name, coalesce(sum(l.sales_amount), 0) as sales
        from outbound_reflection_lines l where ${baseWhere}
        group by 1, 2
      ), previous_sales as (
        select coalesce(nullif(trim(l.marketplace_name), ''), l.marketplace_id, '미분류') as marketplace, coalesce(l.sku, '미매핑') as sku, max(l.product_name) as product_name, coalesce(sum(l.sales_amount), 0) as sales
        from outbound_reflection_lines l where ${previousWhere}
        group by 1, 2
      )
      select coalesce(c.marketplace, p.marketplace) as marketplace, coalesce(c.sku, p.sku) as sku, coalesce(c.product_name, p.product_name, '이름 없음') as product_name, coalesce(c.sales, 0)::text as current_sales, coalesce(p.sales, 0)::text as previous_sales
      from previous_sales p left join current_sales c on c.marketplace = p.marketplace and c.sku = p.sku
      where p.sales > coalesce(c.sales, 0) and p.sales >= 10000
      order by p.sales - coalesce(c.sales, 0) desc limit 8
    `) as unknown as Promise<ChannelProductDropRow[]>,
    db.execute(sql`
      with current_sales as (
        select coalesce(nullif(trim(l.marketplace_name), ''), l.marketplace_id, '미분류') as marketplace, coalesce(l.sku, '미매핑') as sku, max(l.product_name) as product_name, coalesce(sum(l.sales_amount), 0) as sales
        from outbound_reflection_lines l where ${baseWhere}
        group by 1, 2
      ), previous_sales as (
        select coalesce(nullif(trim(l.marketplace_name), ''), l.marketplace_id, '미분류') as marketplace, coalesce(l.sku, '미매핑') as sku, max(l.product_name) as product_name, coalesce(sum(l.sales_amount), 0) as sales
        from outbound_reflection_lines l where ${previousWhere}
        group by 1, 2
      )
      select c.marketplace, c.sku, coalesce(c.product_name, p.product_name, '이름 없음') as product_name, c.sales::text as current_sales, coalesce(p.sales, 0)::text as previous_sales
      from current_sales c left join previous_sales p on p.marketplace = c.marketplace and p.sku = c.sku
      where c.sales > coalesce(p.sales, 0) and c.sales >= 10000
      order by c.sales - coalesce(p.sales, 0) desc limit 8
    `) as unknown as Promise<ChannelProductRiseRow[]>,
    db.execute(sql`
      with stock as (
        select i.sku, max(i.product_name) as product_name, coalesce(sum(i.available_stock), 0)::int as available_stock
        from inventory i where i.user_id = ${userId} group by i.sku
      ), latest_incoming as (
        select i.sku, max(h.created_at) as last_incoming_at
        from inventory_history h join inventory i on i.id = h.inventory_id
        where h.user_id = ${userId} and h.adjustment_reason = 'incoming'
        group by i.sku
      ), sales_since_incoming as (
        select li.sku, coalesce(sum(l.quantity), 0)::int as sold_since_incoming
        from latest_incoming li left join outbound_reflection_lines l on l.user_id = ${userId} and ${eligibleStatus} and l.claim_type is null and l.sku = li.sku and l.shipment_date >= li.last_incoming_at::date and l.shipment_date < ${period.endDate}
        group by li.sku
      )
      select s.sku, s.product_name, s.available_stock, li.last_incoming_at::text, coalesce(ssi.sold_since_incoming, 0)::int as sold_since_incoming
      from stock s join latest_incoming li on li.sku = s.sku left join sales_since_incoming ssi on ssi.sku = s.sku
      where s.available_stock >= 10 and li.last_incoming_at < (${period.endDate}::date - interval '30 days') and coalesce(ssi.sold_since_incoming, 0) <= greatest(1, s.available_stock * 0.1)
      order by s.available_stock desc limit 3
    `) as unknown as Promise<SlowStockRow[]>,
    db.execute(sql`
      select count(distinct i.sku)::int as sku_count, count(*)::int as history_count, max(h.created_at)::text as latest_incoming_at
      from inventory_history h join inventory i on i.id = h.inventory_id
      where h.user_id = ${userId} and h.adjustment_reason = 'incoming'
    `) as unknown as Promise<IncomingCoverageRow[]>,
  ])

  const summary = summaryRows[0] ?? emptySummary()
  const previous = previousRows[0] ?? emptySummary()
  const productCoverage = coverageRows[0] ?? { line_count: 0, cost_known_lines: 0 }
  const incomingCoverage = incomingCoverageRows[0] ?? { sku_count: 0, history_count: 0, latest_incoming_at: null }
  return {
    summary: {
      orders: summary.orders, grossSales: Number(summary.gross_sales), paidShipping: Number(summary.paid_shipping), shippingValueOrders: summary.shipping_value_orders, shippingNonzeroOrders: summary.shipping_nonzero_orders,
      shippingValueCoverage: summary.orders === 0 ? null : summary.shipping_value_orders / summary.orders,
      productCostCoverage: productCoverage.line_count === 0 ? null : productCoverage.cost_known_lines / productCoverage.line_count,
    },
    previous: { orders: previous.orders, grossSales: Number(previous.gross_sales) },
    channels: channelRows.map((row) => ({ marketplace: row.marketplace ?? '미분류', orders: row.orders, sales: Number(row.sales), paidShipping: Number(row.paid_shipping), shippingValueCoverage: row.orders === 0 ? null : row.shipping_value_orders / row.orders })),
    products: productRows.map((row) => ({ sku: row.sku ?? '미매핑', productName: row.product_name ?? '이름 없음', units: row.units, sales: Number(row.sales), costPrice: row.cost_price == null ? null : Number(row.cost_price), shippingCost: row.shipping_cost == null ? null : Number(row.shipping_cost) })),
    productPerformance: productPerformanceRows.map((row) => {
      const sales = Number(row.current_sales)
      const previousSales = Number(row.previous_sales)
      const costPrice = row.cost_price == null ? null : Number(row.cost_price)
      const productCost = costPrice == null ? null : costPrice * row.units
      return { sku: row.sku ?? '미매핑', productName: row.product_name ?? '이름 없음', units: row.units, sales, previousSales, costPrice, productCost, grossProfit: productCost == null ? null : sales - productCost }
    }),
    claims: claimRows,
    specialChannels: specialRows.map((row) => ({ marketplace: row.marketplace ?? '미분류', orders: row.orders, sales: Number(row.sales) })),
    channelProductDrops: channelProductDropRows.map((row) => ({ marketplace: row.marketplace ?? '미분류', sku: row.sku ?? '미매핑', productName: row.product_name ?? '이름 없음', currentSales: Number(row.current_sales), previousSales: Number(row.previous_sales) })),
    channelProductRises: channelProductRiseRows.map((row) => ({ marketplace: row.marketplace ?? '미분류', sku: row.sku ?? '미매핑', productName: row.product_name ?? '이름 없음', currentSales: Number(row.current_sales), previousSales: Number(row.previous_sales) })),
    slowStocks: slowStockRows.map((row) => ({ sku: row.sku, productName: row.product_name, availableStock: row.available_stock, lastIncomingAt: row.last_incoming_at.slice(0, 10), soldSinceIncoming: row.sold_since_incoming })),
    incomingCoverage: { skuCount: incomingCoverage.sku_count, historyCount: incomingCoverage.history_count, latestIncomingAt: incomingCoverage.latest_incoming_at?.slice(0, 10) ?? null },
  }
}

function emptySummary(): SummaryRow {
  return { orders: 0, gross_sales: '0', paid_shipping: '0', shipping_value_orders: 0, shipping_nonzero_orders: 0 }
}
