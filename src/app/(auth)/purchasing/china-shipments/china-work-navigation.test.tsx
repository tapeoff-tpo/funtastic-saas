import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChinaWorkNavigation } from './china-work-navigation'

const { push, replace, currentSearch } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), currentSearch: { value: '' } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }), useSearchParams: () => new URLSearchParams(currentSearch.value) }))

beforeEach(() => {
  vi.resetAllMocks()
  currentSearch.value = ''
})

describe('China work navigation', () => {
  it('opens another shipment through the client router while preserving scroll', () => {
    const { result } = renderHook(() => useChinaWorkNavigation())
    act(() => result.current('/purchasing/china-shipments?shipment=next&step=items'))
    expect(push).toHaveBeenCalledWith('/purchasing/china-shipments?shipment=next&step=items', { scroll: false })
    expect(replace).not.toHaveBeenCalled()
  })

  it.each(['1m', '3m', '6m', '1y'] as const)('returns to the list with the %s period and drops the selected shipment and step', (period) => {
    currentSearch.value = `shipment=current&step=pallets&period=${period}`
    const { result } = renderHook(() => useChinaWorkNavigation())

    act(() => result.current('/purchasing/china-shipments'))

    expect(push).toHaveBeenCalledWith(`/purchasing/china-shipments?period=${period}`, { scroll: false })
  })

  it('returns to the list with the custom date range and drops the selected shipment and step', () => {
    currentSearch.value = 'shipment=current&step=boxes&period=custom&from=2026-09-01&to=2026-09-30'
    const { result } = renderHook(() => useChinaWorkNavigation())

    act(() => result.current('/purchasing/china-shipments'))

    expect(push).toHaveBeenCalledWith('/purchasing/china-shipments?period=custom&from=2026-09-01&to=2026-09-30', { scroll: false })
  })

  it('allows Back and Forward through the list, create screen, and selected shipment before leaving China work', async () => {
    const previousMenu = '/purchasing/orders?view=arrived'
    const list = '/purchasing/china-shipments?period=3m'
    const create = '/purchasing/china-shipments?create=1&period=3m'
    const detail = '/purchasing/china-shipments?shipment=a&step=items&period=3m'
    window.history.replaceState(null, '', previousMenu)
    push.mockImplementation((href: string) => window.history.pushState(null, '', href))
    replace.mockImplementation((href: string) => window.history.replaceState(null, '', href))
    currentSearch.value = 'period=3m'
    const { result } = renderHook(() => useChinaWorkNavigation())

    act(() => result.current('/purchasing/china-shipments'))
    act(() => result.current('/purchasing/china-shipments?create=1'))
    act(() => result.current('/purchasing/china-shipments?shipment=a&step=items'))
    expect(`${window.location.pathname}${window.location.search}`).toBe(detail)

    for (const expected of [create, list, previousMenu]) {
      act(() => window.history.back())
      await waitFor(() => expect(`${window.location.pathname}${window.location.search}`).toBe(expected))
    }
    for (const expected of [list, create, detail]) {
      act(() => window.history.forward())
      await waitFor(() => expect(`${window.location.pathname}${window.location.search}`).toBe(expected))
    }
  })

  it('replaces a completed create screen so Back returns to the list instead of reopening the form', async () => {
    const list = '/purchasing/china-shipments?period=3m'
    const detail = '/purchasing/china-shipments?shipment=created&step=items&period=3m'
    window.history.replaceState(null, '', list)
    push.mockImplementation((href: string) => window.history.pushState(null, '', href))
    replace.mockImplementation((href: string) => window.history.replaceState(null, '', href))
    currentSearch.value = 'period=3m'
    const { result } = renderHook(() => useChinaWorkNavigation())

    act(() => result.current('/purchasing/china-shipments?create=1'))
    act(() => result.current('/purchasing/china-shipments?shipment=created&step=items', { replace: true }))
    expect(replace).toHaveBeenCalledWith(detail, { scroll: false })
    expect(`${window.location.pathname}${window.location.search}`).toBe(detail)

    act(() => window.history.back())
    await waitFor(() => expect(`${window.location.pathname}${window.location.search}`).toBe(list))
    act(() => window.history.forward())
    await waitFor(() => expect(`${window.location.pathname}${window.location.search}`).toBe(detail))
  })
})
