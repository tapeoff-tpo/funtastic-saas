import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useIntentPrefetch } from './use-intent-prefetch'

const prefetch = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ prefetch }) }))
beforeEach(() => { vi.useFakeTimers(); prefetch.mockClear() })
afterEach(() => vi.useRealTimers())

describe('navigation intent prefetch', () => {
  it('does not load every visible tab or routes briefly crossed by the pointer', () => {
    const { result } = renderHook(useIntentPrefetch)
    expect(prefetch).not.toHaveBeenCalled()
    act(() => { result.current.prepare('/orders'); vi.advanceTimersByTime(50); result.current.cancel(); vi.advanceTimersByTime(200) })
    expect(prefetch).not.toHaveBeenCalled()
    act(() => { result.current.prepare('/inventory'); vi.advanceTimersByTime(120) })
    expect(prefetch).toHaveBeenCalledExactlyOnceWith('/inventory')
  })
  it('deduplicates focus and hover, and permits fresh data after the router freshness window', () => {
    const { result } = renderHook(useIntentPrefetch)
    act(() => { result.current.prepare('/orders'); result.current.prepare('/orders'); vi.advanceTimersByTime(120) })
    act(() => { result.current.prepare('/orders'); vi.advanceTimersByTime(120) })
    expect(prefetch).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(15_000); result.current.prepare('/orders'); vi.advanceTimersByTime(120) })
    expect(prefetch).toHaveBeenCalledTimes(2)
  })
  it('cancels pending work on unmount', () => {
    const { result, unmount } = renderHook(useIntentPrefetch)
    act(() => result.current.prepare('/orders'))
    unmount(); act(() => vi.advanceTimersByTime(200))
    expect(prefetch).not.toHaveBeenCalled()
  })
})
