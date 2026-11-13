export type FundMonth = {
  month: string
  depositedCny: number | null
  debitedCny: number | null
  products: Array<{ sku: string; name: string; amountCny: number }>
}

type FundRow = {
  entryType: string
  occurredOn: string
  amountCny: string | number | null
  missingCostCount: number
  details: unknown
}

export function summarizeFundMonths(rows: FundRow[]): FundMonth[] {
  const months = new Map<string, {
    deposited: number; debited: number; missingDeposit: boolean; missingDebit: boolean
    products: Map<string, { sku: string; name: string; amountCny: number }>
  }>()
  for (const row of rows) {
    const month = String(row.occurredOn).slice(0, 7)
    const data = months.get(month) ?? { deposited: 0, debited: 0, missingDeposit: false, missingDebit: false, products: new Map() }
    months.set(month, data)
    const amount = row.amountCny === null || row.amountCny === '' ? null : Number(row.amountCny)
    if (row.entryType !== 'purchase_debit') {
      if (amount === null || !Number.isFinite(amount)) data.missingDeposit = true
      else data.deposited += amount
      continue
    }
    if (amount === null || !Number.isFinite(amount) || row.missingCostCount > 0) data.missingDebit = true
    else data.debited += amount
    const details = row.details as { lines?: Array<{ sku?: unknown; productName?: unknown; totalCostYuan?: unknown }> } | null
    if (!Array.isArray(details?.lines)) continue
    for (const line of details.lines) {
      if (line.totalCostYuan === null || line.totalCostYuan === undefined || line.totalCostYuan === '') continue
      const cost = Number(line.totalCostYuan)
      if (!Number.isFinite(cost)) continue
      const sku = typeof line.sku === 'string' ? line.sku.trim() : ''
      const name = typeof line.productName === 'string' && line.productName.trim() ? line.productName.trim() : (sku || '상품명 없음')
      const item = data.products.get(name) ?? { sku, name, amountCny: 0 }
      if (item.sku !== sku) item.sku = ''
      item.amountCny += cost
      data.products.set(name, item)
    }
  }
  const round = (n: number) => Math.round(n * 100) / 100
  return [...months.entries()].map(([month, value]) => ({
    month,
    depositedCny: value.missingDeposit ? null : round(value.deposited),
    debitedCny: value.missingDebit ? null : round(value.debited),
    products: [...value.products.values()].map((item) => ({ ...item, amountCny: round(item.amountCny) })).sort((a, b) => b.amountCny - a.amountCny).slice(0, 10),
  })).sort((a, b) => b.month.localeCompare(a.month))
}
