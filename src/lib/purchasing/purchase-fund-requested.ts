import { calculatePurchaseCosts } from './purchase-costs'
import { isUniqueSupplierOrderIdentifier, normalizeSupplierOrderReference } from './supplier-order-reference'
import type { PurchaseFundDebitSourceRow } from './purchase-fund-ledger'

type ExistingDebit = { details: unknown; supplierOrderNumber?: string | null }
type Line = { sourcePurchaseItemId?: unknown; purchaseManagementCode?: unknown; sku?: unknown }

/** Read-only provisional charges for requests not already represented by a debit. */
export function buildRequestedFundCharges(rows: PurchaseFundDebitSourceRow[], existing: ExistingDebit[], rate: number) {
  const chargedIds = new Set<string>()
  const linesBySku = new Map<string, Array<{ management: string | null; supplier: string | null; sourceId: string | null }>>()
  const unidentifiableOrders: Array<string | null> = []
  for (const debit of existing) {
    const details = debit.details as { lines?: Line[] } | null
    if (!Array.isArray(details?.lines) || details.lines.length === 0) {
      unidentifiableOrders.push(isUniqueSupplierOrderIdentifier(debit.supplierOrderNumber) ? debit.supplierOrderNumber!.trim() : null)
      continue
    }
    for (const line of details.lines) {
      if (typeof line.sourcePurchaseItemId === 'string') chargedIds.add(line.sourcePurchaseItemId)
      const management = managementKey(line.purchaseManagementCode, line.sku)
      const supplier = supplierKey(debit.supplierOrderNumber, line.sku)
      if (typeof line.sku === 'string' && line.sku.trim()) {
        const sku = line.sku.trim().replace(/\s+/g, ' ')
        const matches = linesBySku.get(sku) ?? []
        matches.push({ management, supplier, sourceId: typeof line.sourcePurchaseItemId === 'string' ? line.sourcePurchaseItemId : null })
        linesBySku.set(sku, matches)
      }
    }
  }
  const candidates = new Map<string, PurchaseFundDebitSourceRow>()
  const unverifiedCompleted: PurchaseFundDebitSourceRow[] = []
  for (const row of rows) {
    if (row.status === 'requested') continue
    const date = row.requestDate ?? kstDate(row.createdAt)
    if (date < '2026-11-01') continue
    const management = managementKey(row.purchaseManagementCode, row.sku)
    const supplier = supplierKey(row.supplierOrderNumber, row.sku)
    const identity = management ?? supplier
    const matchingLines = linesBySku.get(row.sku.trim().replace(/\s+/g, ' ')) ?? []
    const alreadyCharged = matchingLines.some((line) => (
      management && line.management ? management === line.management
        : supplier && line.supplier ? supplier === line.supplier
          : false
    ))
    if (chargedIds.has(row.id) || alreadyCharged) continue
    if (row.status === 'completed') {
      // The completed row is not another charge. If its original charge is
      // unavailable, keep the balance unknown instead of silently restoring it.
      const representedByActiveRow = rows.some((other) => {
        if (other.status === 'completed' || other.status === 'requested' || other.sku.trim() !== row.sku.trim()) return false
        const otherManagement = managementKey(other.purchaseManagementCode, other.sku)
        const otherSupplier = supplierKey(other.supplierOrderNumber, other.sku)
        return Boolean(management && otherManagement ? management === otherManagement : supplier && otherSupplier && supplier === otherSupplier)
      })
      if (!representedByActiveRow) unverifiedCompleted.push(row)
      continue
    }
    // Items with a supplier number at later stages are handled by the existing
    // durable purchase-debit ledger, including its missing-cost handling.
    if (row.status !== 'purchased' && normalizeSupplierOrderReference(row.supplierOrderNumber)) continue
    const key = identity ?? `row:${row.id}`
    const previous = candidates.get(key)
    if (!previous || priority[row.status] > priority[previous.status] || (priority[row.status] === priority[previous.status] && quantity(row) > quantity(previous))) candidates.set(key, row)
  }
  const candidateList = [...candidates.values()]
  const pending = candidateList.map((row) => {
    const costs = calculatePurchaseCosts({ requestedQuantity: quantity(row), specialPriceCny: row.specialPriceCny, newCostCny: row.newCostCny, exchangeRateKrw: row.costExchangeRateKrw ?? rate })
    const management = managementKey(row.purchaseManagementCode, row.sku)
    const supplier = supplierKey(row.supplierOrderNumber, row.sku)
    const sameSku = linesBySku.get(row.sku.trim().replace(/\s+/g, ' ')) ?? []
    const ambiguousLine = sameSku.some((line) => {
      if ((management && line.management) || (supplier && line.supplier)) return false
      const earlier = line.sourceId ? rows.find((source) => source.id === line.sourceId) : undefined
      return !earlier || !wasReceivedBeforeRequest(earlier, row)
    })
    const ambiguousOrder = unidentifiableOrders.some((order) => !order || !supplier || order === row.supplierOrderNumber?.trim())
    const ambiguousCandidate = candidateList.some((other) => {
      if (other.id === row.id || other.sku.trim() !== row.sku.trim()) return false
      if (wasReceivedBeforeRequest(other, row) || wasReceivedBeforeRequest(row, other)) return false
      const otherManagement = managementKey(other.purchaseManagementCode, other.sku)
      const otherSupplier = supplierKey(other.supplierOrderNumber, other.sku)
      return !(management && otherManagement) && !(supplier && otherSupplier && supplier !== otherSupplier)
    })
    const ambiguous = ambiguousLine || ambiguousOrder || ambiguousCandidate
    return { id: row.id, occurredOn: row.requestDate ?? kstDate(row.createdAt), requestDate: row.requestDate, createdAt: row.createdAt, amountCny: ambiguous ? null : costs.totalCostYuan, amountKrw: ambiguous ? null : costs.totalCostKrw, sku: row.sku, productName: row.productName, purchaseManagementCode: row.purchaseManagementCode, ambiguous, completedUnverified: false }
  })
  return [...pending, ...unverifiedCompleted.map((row) => ({
    id: row.id, occurredOn: row.requestDate ?? kstDate(row.createdAt), requestDate: row.requestDate, createdAt: row.createdAt,
    amountCny: null, amountKrw: null, sku: row.sku, productName: row.productName, purchaseManagementCode: row.purchaseManagementCode,
    ambiguous: true, completedUnverified: true,
  }))]
}

/** Only a verified earlier warehouse arrival can separate an unidentified repeat order. */
function wasReceivedBeforeRequest(earlier: PurchaseFundDebitSourceRow, later: PurchaseFundDebitSourceRow) {
  if (later.status !== 'purchased' || !later.requestDate) return false
  if (!['china_arrived', 'outbound_requested', 'completed'].includes(earlier.status)) return false
  const rawSource = earlier.rawData.source
  // For Ecount-imported warehouse rows chinaReceivedAt may be the purchase
  // date, not the arrival date. A successful snapshot proves the status only
  // by the time it was synchronized.
  const receivedAt = typeof rawSource === 'string' && rawSource.startsWith('ecount_')
    ? (typeof earlier.rawData.syncedAt === 'string' ? earlier.rawData.syncedAt : null)
    : earlier.chinaReceivedAt
  if (!receivedAt) return false
  const day = kstDate(receivedAt)
  return Boolean(day && day < later.requestDate)
}

/** A request created before an opening balance may have entered the request stage later. */
export function requestedChargeOpeningBoundary(charge: { requestDate: string | null; createdAt: Date | string }, openingCreatedAt: Date | null): 'include' | 'exclude' | 'uncertain' {
  if (!openingCreatedAt) return 'include'
  const createdTime = new Date(charge.createdAt).getTime()
  if (Number.isFinite(createdTime) && createdTime >= openingCreatedAt.getTime()) return 'include'
  if (!charge.requestDate) return 'uncertain'
  const openingDay = kstDate(openingCreatedAt)
  return charge.requestDate > openingDay ? 'include' : charge.requestDate < openingDay ? 'exclude' : 'uncertain'
}

const priority: Record<PurchaseFundDebitSourceRow['status'], number> = { requested: 0, purchased: 1, purchase_completed: 2, inspecting: 3, china_arrived: 4, outbound_requested: 5, completed: 6 }

function managementKey(code: unknown, sku: unknown) {
  if (typeof code !== 'string' || !code.trim() || typeof sku !== 'string' || !sku.trim()) return null
  return `management:${code.trim().replace(/\s+/g, ' ')}|${sku.trim().replace(/\s+/g, ' ')}`
}

function supplierKey(order: unknown, sku: unknown) {
  if (typeof order !== 'string' || !isUniqueSupplierOrderIdentifier(order) || typeof sku !== 'string' || !sku.trim()) return null
  return `supplier:${order.trim()}|${sku.trim().replace(/\s+/g, ' ')}`
}

function quantity(row: PurchaseFundDebitSourceRow) {
  const original = Number(row.rawData.purchasedQuantity)
  if ((row.status === 'outbound_requested' || row.status === 'completed') && Number.isInteger(original) && original > 0) return original
  return Math.max(0, Math.trunc(row.actualPurchaseQuantity ?? row.requestedQuantity))
}

function kstDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date) : ''
}

