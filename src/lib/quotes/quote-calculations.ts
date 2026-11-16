/**
 * Pure, browser-safe calculations shared by the sales workspace and printable
 * quote. The rules intentionally mirror the existing Funtastic quote tool:
 * a VAT-inclusive unit price is split into 10/11 supply and 1/11 VAT after
 * rounding the line total, while a VAT-exclusive price receives 10% VAT.
 */

export type QuoteNumber = number | string | null | undefined

export type SalesStatus = 'pending' | 'inProgress' | 'blocked' | 'completed'
export type TrackingStatus = 'before' | 'completed'

export type QuoteLineInput = {
  qty?: QuoteNumber
  price?: QuoteNumber
  vatIncluded?: boolean | null
}

export type QuoteLineTotals = {
  supply: number
  vat: number
  total: number
}

export type SalesItemInput = QuoteLineInput & {
  cost?: QuoteNumber
  wholesalePrice?: QuoteNumber
}

/** A sales line with the customer-facing fields used to create a quote. */
export type SalesItemForQuote = SalesItemInput & {
  productCode?: string | null
  name?: string | null
  spec?: string | null
  note?: string | null
}

/** A printable quote line copied from a sales record. */
export type QuoteItemFromSale = QuoteLineInput & {
  id: number
  name: string
  spec: string
  note: string
}

export type SalesItemMargin = {
  discountRate: number | null
  unitGross: number | null
  unitVat: number | null
  unitProfit: number | null
  unitProfitRate: number | null
  totalGross: number | null
  totalVat: number | null
  totalCost: number | null
  totalProfit: number | null
  totalProfitRate: number | null
}

export type SalesMarginInput = {
  items?: readonly SalesItemInput[] | null
  includeShipping?: boolean | null
  shippingFee?: QuoteNumber
  shippingVatIncluded?: boolean | null
  shippingCost?: QuoteNumber
}

export type SalesRecordForQuote = Omit<SalesMarginInput, 'items'> & {
  items?: readonly SalesItemForQuote[] | null
}

export type SalesMarginTotals = {
  items: SalesItemMargin[]
  subtotalGross: number | null
  subtotalVat: number | null
  shippingGross: number | null
  shippingVat: number | null
  shippingCost: number | null
  totalGross: number | null
  totalVat: number | null
  totalCost: number | null
  totalProfit: number | null
  totalProfitRate: number | null
}

export type TrackingEntry = {
  status?: TrackingStatus | string | null
}

export type SalesRecordForTotals = SalesMarginInput & {
  status?: SalesStatus | string | null
  quoteDate?: string | null
  saleDate?: string | null
  createdAt?: string | Date | null
}

export type MonthlySalesTotal = {
  month: string
  label: string
  totalGross: number
  totalCost: number | null
  totalProfit: number | null
  totalProfitRate: number | null
}

export type SalesStatusSummary = Record<SalesStatus, number> & {
  total: number
}

/**
 * Parses the number format retained by the workspace state. The client strips
 * display commas before storing a field, so a formatted value is deliberately
 * not treated as a valid persisted number here.
 */
export function parseQuoteNumber(value: QuoteNumber): number | null {
  if (typeof value === 'string') {
    if (value.trim() === '') return null
    value = Number(value)
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return value === 0 ? 0 : value
}

/** Calculates one printable quote line including its VAT split. */
export function calculateQuoteLineTotals(input: QuoteLineInput = {}): QuoteLineTotals {
  const quantity = parseQuoteNumber(input.qty) ?? 0
  const price = parseQuoteNumber(input.price) ?? 0
  const gross = Math.round(price * quantity)

  if (input.vatIncluded) {
    const vat = Math.round(gross / 11)
    return { supply: gross - vat, vat, total: gross }
  }

  const vat = Math.round(gross * 0.1)
  return { supply: gross, vat, total: gross + vat }
}

/** Adds printable quote lines without silently dropping blank rows. */
export function calculateQuoteTotals(lines: readonly QuoteLineInput[] | null | undefined): QuoteLineTotals {
  return (lines ?? []).reduce<QuoteLineTotals>((totals, line) => {
    const next = calculateQuoteLineTotals(line)
    return {
      supply: totals.supply + next.supply,
      vat: totals.vat + next.vat,
      total: totals.total + next.total,
    }
  }, { supply: 0, vat: 0, total: 0 })
}

/**
 * Copies only customer-facing sale fields into a new quote snapshot. Internal
 * cost and wholesale figures intentionally never leave the sales editor. A
 * charged delivery fee is represented as its own printable line, matching the
 * original quote tool.
 */
export function quoteItemsFromSale(sale: SalesRecordForQuote = {}): QuoteItemFromSale[] {
  const sourceItems = sale.items ?? []
  const items = sourceItems
    .filter((item) => typeof item.name === 'string' && item.name.trim())
    .map((item, index) => ({
      id: index + 1,
      name: item.name ?? '',
      spec: customerOption(item.spec),
      qty: item.qty,
      price: item.price,
      vatIncluded: Boolean(item.vatIncluded),
      note: item.note ?? '',
    }))

  const shippingFee = parseQuoteNumber(sale.shippingFee)
  if (sale.includeShipping && shippingFee !== null && shippingFee > 0) {
    items.push({
      id: items.length + 1,
      name: '배송비',
      spec: '건',
      qty: 1,
      price: sale.shippingFee,
      vatIncluded: Boolean(sale.shippingVatIncluded),
      note: '',
    })
  }
  return items
}

/** Formats the Korean amount wording used underneath the printable total. */
export function formatKoreanWon(value: QuoteNumber): string {
  const numeric = Number(value)
  const amount = Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : 0
  if (amount === 0) return '금영원정'

  const largeUnits = ['', '만', '억', '조']
  const digits = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']
  const positions = ['', '십', '백', '천']
  let result = ''
  let remaining = amount
  let unitIndex = 0

  while (remaining > 0) {
    const group = remaining % 10000
    if (group > 0) {
      let groupText = ''
      let cursor = group

      for (let position = 0; position < 4; position += 1) {
        const digit = cursor % 10
        if (digit > 0) {
          groupText = `${digit === 1 && position > 0 ? '' : digits[digit]}${positions[position]}${groupText}`
        }
        cursor = Math.floor(cursor / 10)
      }

      result = `${groupText}${largeUnits[unitIndex] ?? ''}${result}`
    }

    remaining = Math.floor(remaining / 10000)
    unitIndex += 1
  }

  return `금${result}원정`
}

/**
 * Calculates the unit and line margin shown in sales editing. Unlike printable
 * quote totals, blank price, quantity, or cost stays unknown (`null`) so a
 * partial sales record cannot look profitable by accident.
 */
export function calculateSalesItemMargin(input: SalesItemInput = {}): SalesItemMargin {
  const price = parseQuoteNumber(input.price)
  const cost = parseQuoteNumber(input.cost)
  const wholesalePrice = parseQuoteNumber(input.wholesalePrice)
  const quantity = parseQuoteNumber(input.qty)

  const discountRate = price === null || wholesalePrice === null || wholesalePrice === 0
    ? null
    : 1 - (price / wholesalePrice)
  const unitVat = price === null ? null : input.vatIncluded ? price / 11 : price * 0.1
  const unitGross = price === null ? null : input.vatIncluded ? price : price + (price * 0.1)
  const unitProfit = unitGross === null || unitVat === null || cost === null
    ? null
    : unitGross - unitVat - cost
  const unitProfitRate = divideOrNull(unitProfit, unitGross)
  const quoteTotals = price === null || quantity === null
    ? null
    : calculateQuoteLineTotals({ price, qty: quantity, vatIncluded: input.vatIncluded })
  const totalGross = quoteTotals?.total ?? null
  const totalVat = quoteTotals?.vat ?? null
  const totalCost = cost === null || quantity === null ? null : Math.round(cost * quantity)
  const totalProfit = totalGross === null || totalVat === null || totalCost === null
    ? null
    : totalGross - totalVat - totalCost

  return {
    discountRate,
    unitGross,
    unitVat,
    unitProfit,
    unitProfitRate,
    totalGross,
    totalVat,
    totalCost,
    totalProfit,
    totalProfitRate: divideOrNull(totalProfit, totalGross),
  }
}

/** Calculates the sales summary, including optionally charged and actual shipping. */
export function calculateSalesMarginTotals(input: SalesMarginInput = {}): SalesMarginTotals {
  const items = (input.items ?? []).map((item) => calculateSalesItemMargin(item))
  const shippingFee = input.includeShipping ? parseQuoteNumber(input.shippingFee) : 0
  const shippingQuote = shippingFee === null
    ? null
    : calculateQuoteLineTotals({
      qty: 1,
      price: shippingFee,
      vatIncluded: input.shippingVatIncluded,
    })
  const shippingCost = parseQuoteNumber(input.shippingCost)
  const subtotalGross = sumNullable(items.map((item) => item.totalGross))
  const subtotalVat = sumNullable(items.map((item) => item.totalVat))
  const totalCost = sumNullable(items.map((item) => item.totalCost))
  const shippingGross = shippingQuote?.total ?? null
  const shippingVat = shippingQuote?.vat ?? null
  const totalGross = sumNullable([subtotalGross, shippingGross])
  const totalVat = sumNullable([subtotalVat, shippingVat])
  const totalProfit = totalGross === null || totalVat === null || totalCost === null || shippingCost === null
    ? null
    : totalGross - totalVat - totalCost - shippingCost

  return {
    items,
    subtotalGross,
    subtotalVat,
    shippingGross,
    shippingVat,
    shippingCost,
    totalGross,
    totalVat,
    totalCost,
    totalProfit,
    totalProfitRate: divideOrNull(totalProfit, totalGross),
  }
}

/** Derives the automatic workflow state from every shipment and payment row. */
export function deriveSalesStatus(
  shipments: readonly TrackingEntry[] | null | undefined,
  payments: readonly TrackingEntry[] | null | undefined,
): Exclude<SalesStatus, 'blocked'> {
  const tracking = [...trackingEntriesOrDefault(shipments), ...trackingEntriesOrDefault(payments)]
  if (tracking.every((entry) => entry.status === 'completed')) return 'completed'
  if (tracking.some((entry) => entry.status === 'completed')) return 'inProgress'
  return 'pending'
}

/** Counts every list status, normalizing malformed or missing values to pending. */
export function summarizeSalesStatuses(
  records: readonly Pick<SalesRecordForTotals, 'status'>[] | null | undefined,
): SalesStatusSummary {
  const summary: SalesStatusSummary = {
    total: 0,
    pending: 0,
    inProgress: 0,
    blocked: 0,
    completed: 0,
  }

  for (const record of records ?? []) {
    const status = normalizeSalesStatus(record.status)
    summary.total += 1
    summary[status] += 1
  }

  return summary
}

/** The remote sales dashboard includes only progressing and completed records in money totals. */
export function isSalesStatusIncludedInTotals(status: SalesStatus | string | null | undefined): boolean {
  const normalized = normalizeSalesStatus(status)
  return normalized === 'inProgress' || normalized === 'completed'
}

/** Uses quote date, then sale date, then creation date, matching the sales list sort/filter rule. */
export function salesRecordDate(record: Pick<SalesRecordForTotals, 'quoteDate' | 'saleDate' | 'createdAt'>): string {
  const candidate = record.quoteDate || record.saleDate || record.createdAt || ''
  const text = candidate instanceof Date ? candidate.toISOString() : String(candidate).trim()
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : ''
}

/** Produces the twelve-month sales cards shown by the external sales management screen. */
export function calculateMonthlySalesTotals(
  records: readonly SalesRecordForTotals[] | null | undefined,
  year: string | number,
): MonthlySalesTotal[] {
  const normalizedYear = String(year).slice(0, 4)
  const months: MonthlySalesTotal[] = Array.from({ length: 12 }, (_, index) => ({
    month: String(index + 1).padStart(2, '0'),
    label: `${index + 1}월`,
    totalGross: 0,
    totalCost: 0,
    totalProfit: 0,
    totalProfitRate: null,
  }))

  if (!/^\d{4}$/.test(normalizedYear)) return months

  for (const record of records ?? []) {
    if (!isSalesStatusIncludedInTotals(record.status)) continue
    const date = salesRecordDate(record)
    if (!date || date.slice(0, 4) !== normalizedYear) continue

    const month = months[Number(date.slice(5, 7)) - 1]
    if (!month) continue

    const totals = calculateSalesMarginTotals(record)
    if (typeof totals.totalGross === 'number' && Number.isFinite(totals.totalGross)) {
      month.totalGross += totals.totalGross
    }
    if (month.totalCost !== null && typeof totals.totalCost === 'number' && Number.isFinite(totals.totalCost)) {
      month.totalCost += totals.totalCost
    } else if (totals.totalCost === null) {
      month.totalCost = null
    }
    if (month.totalProfit !== null && typeof totals.totalProfit === 'number' && Number.isFinite(totals.totalProfit)) {
      month.totalProfit += totals.totalProfit
    } else if (totals.totalProfit === null) {
      month.totalProfit = null
    }
  }

  return months.map((month) => ({
    ...month,
    totalProfitRate: divideOrNull(month.totalProfit, month.totalGross),
  }))
}

function sumNullable(values: readonly (number | null)[]): number | null {
  if (values.some((value) => value === null)) return null
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
}

function customerOption(value: unknown): string {
  const text = String(value ?? '')
  return text.trim().toUpperCase() === 'EA' ? '' : text
}

function divideOrNull(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null
  return numerator / denominator
}

function trackingEntriesOrDefault(entries: readonly TrackingEntry[] | null | undefined): readonly TrackingEntry[] {
  return entries && entries.length > 0 ? entries : [{ status: 'before' }]
}

function normalizeSalesStatus(status: SalesStatus | string | null | undefined): SalesStatus {
  return status === 'inProgress' || status === 'blocked' || status === 'completed' ? status : 'pending'
}
