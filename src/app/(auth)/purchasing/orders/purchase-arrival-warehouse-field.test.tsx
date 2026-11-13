import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PurchaseArrivalWarehouseField } from './purchase-request-actions'

const refresh = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }), usePathname: () => '/purchasing/orders', useSearchParams: () => new URLSearchParams() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
afterEach(() => { vi.restoreAllMocks(); refresh.mockClear() })

describe('purchase warehouse source display', () => {
  it('selects an imported original name without issuing an update or changing inventory mode', () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
    render(<PurchaseArrivalWarehouseField id="purchase-1" warehouse="쿠팡" />)
    expect(screen.getByRole('combobox', { name: '입고 창고' })).toHaveValue('쿠팡')
    expect(screen.getByRole('option', { name: '쿠팡' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '쿠팡' })).toBeDisabled()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('still saves an explicit manual warehouse correction through the existing guarded action', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response)
    render(<PurchaseArrivalWarehouseField id="purchase-1" warehouse="중국창고" />)
    fireEvent.change(screen.getByRole('combobox', { name: '입고 창고' }), { target: { value: '대량창고' } })
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/purchasing/purchase-requests/purchase-1', expect.objectContaining({ body: JSON.stringify({ arrivalWarehouseCode: '대량창고' }) })))
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
  })
})
