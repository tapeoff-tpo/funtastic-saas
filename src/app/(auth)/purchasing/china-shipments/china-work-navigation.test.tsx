import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useChinaWorkNavigation } from './china-work-navigation'

const replace = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }))

describe('China work navigation', () => {
  it('opens another shipment through the client router while preserving scroll', () => {
    const { result } = renderHook(() => useChinaWorkNavigation())
    act(() => result.current('/purchasing/china-shipments?shipment=next&step=items'))
    expect(replace).toHaveBeenCalledWith('/purchasing/china-shipments?shipment=next&step=items', { scroll: false })
  })
})
