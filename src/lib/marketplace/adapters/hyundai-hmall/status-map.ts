import type { OrderStatus } from '@/lib/orders/types'

export function mapHyundaiHmallStatus(params: {
  progressCode?: string | null
  confirmedAt?: string | null
  invoiceNo?: string | null
  cancelled?: string | null
}): OrderStatus {
  const progressCode = String(params.progressCode ?? '').trim().toUpperCase()
  if (String(params.cancelled ?? '').trim().toUpperCase() === 'Y') return 'cancelled'
  if (params.invoiceNo) return 'ready'
  if (progressCode === 'P3') return 'delivered'
  if (progressCode === 'P2') return 'shipped'
  if (progressCode === 'P1' || params.confirmedAt) return 'confirmed'
  if (progressCode === 'P0') return 'new'

  const numeric = Number(progressCode)
  if (Number.isFinite(numeric)) {
    if (numeric >= 60) return 'delivered'
    if (numeric >= 40) return 'shipped'
    if (numeric >= 30) return 'ready'
    if (numeric >= 25) return 'confirmed'
  }

  return 'new'
}
