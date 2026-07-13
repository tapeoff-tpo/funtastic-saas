export const PURCHASE_DELAY_TRACKING_START_DATE = '2026-07-01'

export function isPurchaseDelayTrackingDate(requestDate: string | null | undefined) {
  return Boolean(requestDate && requestDate >= PURCHASE_DELAY_TRACKING_START_DATE)
}
