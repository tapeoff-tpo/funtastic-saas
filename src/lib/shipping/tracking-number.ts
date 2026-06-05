export function normalizeTrackingNumber(value: unknown): string {
  return String(value ?? '').trim().replace(/[^0-9A-Za-z]/g, '').toUpperCase()
}
