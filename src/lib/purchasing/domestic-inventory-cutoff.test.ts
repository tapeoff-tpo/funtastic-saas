import { describe, expect, it } from 'vitest'
import { resolveDomesticInventoryReflectedThrough } from './domestic-inventory-cutoff'

describe('resolveDomesticInventoryReflectedThrough', () => {
  it('uses a newer successful refresh event instead of a stale page value', () => {
    expect(resolveDomesticInventoryReflectedThrough({
      requestedDate: '2026-10-28',
      latestSuccessfulRefreshAt: '2026-11-04T08:34:20.280Z',
    })).toBe('2026-11-04')
  })

  it('formats the successful refresh timestamp in the Seoul business date', () => {
    expect(resolveDomesticInventoryReflectedThrough({
      requestedDate: '2026-11-03',
      latestSuccessfulRefreshAt: '2026-11-03 15:05:00+00',
    })).toBe('2026-11-04')
  })

  it('uses the successful refresh event even when the requested date is newer', () => {
    expect(resolveDomesticInventoryReflectedThrough({
      requestedDate: '2026-11-05',
      latestSuccessfulRefreshAt: '2026-11-04T08:34:20.280Z',
    })).toBe('2026-11-04')
  })

  it('keeps the requested cutoff when no successful refresh was recorded', () => {
    expect(resolveDomesticInventoryReflectedThrough({
      requestedDate: '2026-11-04',
      latestSuccessfulRefreshAt: null,
    })).toBe('2026-11-04')
  })
})
