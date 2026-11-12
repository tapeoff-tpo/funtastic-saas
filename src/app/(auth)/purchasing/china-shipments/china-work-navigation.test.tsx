import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChinaWorkNavigation } from './china-work-navigation'

const { replace, currentSearch } = vi.hoisted(() => ({ replace: vi.fn(), currentSearch: { value: '' } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }), useSearchParams: () => new URLSearchParams(currentSearch.value) }))

beforeEach(() => {
  vi.clearAllMocks()
  currentSearch.value = ''
})

describe('China work navigation', () => {
  it('opens another shipment through the client router while preserving scroll', () => {
    const { result } = renderHook(() => useChinaWorkNavigation())
    act(() => result.current('/purchasing/china-shipments?shipment=next&step=items'))
    expect(replace).toHaveBeenCalledWith('/purchasing/china-shipments?shipment=next&step=items', { scroll: false })
  })

  it.each(['1m', '3m', '6m', '1y'] as const)('returns to the list with the %s period and drops the selected shipment and step', (period) => {
    currentSearch.value = `shipment=current&step=pallets&period=${period}`
    const { result } = renderHook(() => useChinaWorkNavigation())

    act(() => result.current('/purchasing/china-shipments'))

    expect(replace).toHaveBeenCalledWith(`/purchasing/china-shipments?period=${period}`, { scroll: false })
  })

  it('returns to the list with the custom date range and drops the selected shipment and step', () => {
    currentSearch.value = 'shipment=current&step=boxes&period=custom&from=2026-09-01&to=2026-09-30'
    const { result } = renderHook(() => useChinaWorkNavigation())

    act(() => result.current('/purchasing/china-shipments'))

    expect(replace).toHaveBeenCalledWith('/purchasing/china-shipments?period=custom&from=2026-09-01&to=2026-09-30', { scroll: false })
  })
})
