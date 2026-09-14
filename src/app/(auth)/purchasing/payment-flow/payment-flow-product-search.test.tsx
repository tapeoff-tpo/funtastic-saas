import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PaymentFlowProductSearch } from './payment-flow-product-search'

const push = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

describe('PaymentFlowProductSearch', () => {
  beforeEach(() => push.mockReset())

  it('searches within the selected amount view and keeps list settings', async () => {
    render(<PaymentFlowProductSearch view="bulk_pending" search="" pageSize={100} sort="totalCostKrw" order="desc" />)

    fireEvent.change(screen.getByRole('searchbox', { name: '상품 검색' }), { target: { value: '찜기' } })
    fireEvent.click(screen.getByRole('button', { name: '현재 항목 검색' }))

    await waitFor(() => expect(push).toHaveBeenCalledOnce())
    const [href, options] = push.mock.calls[0]
    const url = new URL(href, 'https://example.test')
    expect(url.searchParams.get('view')).toBe('bulk_pending')
    expect(url.searchParams.get('search')).toBe('찜기')
    expect(url.searchParams.get('pageSize')).toBe('100')
    expect(url.searchParams.get('sort')).toBe('totalCostKrw')
    expect(url.searchParams.get('order')).toBe('desc')
    expect(url.searchParams.has('page')).toBe(false)
    expect(options).toEqual({ scroll: false })
  })

  it('can search all amount views from an individual view', async () => {
    render(<PaymentFlowProductSearch view="outstanding" search="" pageSize={50} sort={null} order="desc" />)

    fireEvent.change(screen.getByRole('searchbox', { name: '상품 검색' }), { target: { value: '111973-0001' } })
    fireEvent.click(screen.getByRole('button', { name: '전체 검색' }))

    await waitFor(() => expect(push).toHaveBeenCalledOnce())
    const url = new URL(push.mock.calls[0][0], 'https://example.test')
    expect(url.searchParams.get('view')).toBe('total')
    expect(url.searchParams.get('search')).toBe('111973-0001')
  })
})
