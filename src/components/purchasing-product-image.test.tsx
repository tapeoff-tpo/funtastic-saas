import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PurchasingProductImageButton } from './purchasing-product-image'
const base = { sku: 'SKU-1', productName: '유리컵', source: 'item-master', imageUrls: ['/broken.jpg'] }
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event('close')) }
})
describe('product image popup', () => {
  it('preloads on keyboard focus and opens/reopens without another metadata request', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(base))
    vi.stubGlobal('fetch', fetcher)
    render(<PurchasingProductImageButton productName="유리컵" purchaseItemId="cached-id" />)
    const button = screen.getByRole('button', { name: '유리컵' })
    fireEvent.focus(button)
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(button)
    expect(await screen.findByRole('img')).toHaveAttribute('src', '/broken.jpg')
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    fireEvent.click(button)
    expect(screen.getByRole('img')).toHaveAttribute('src', '/broken.jpg')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('falls back from a broken saved image to B2B without altering the item', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(base)).mockResolvedValueOnce(response({ ...base, source: 'funtasticb2b', imageUrls: ['https://images.example/cup.jpg'] }))
    vi.stubGlobal('fetch', fetcher)
    render(<PurchasingProductImageButton productName="유리컵" shipmentItemId="item-id" />)
    fireEvent.click(screen.getByRole('button', { name: '유리컵' }))
    fireEvent.error(await screen.findByRole('img', { name: '유리컵' }))
    await waitFor(() => expect(screen.getByRole('img', { name: '유리컵' })).toHaveAttribute('src', 'https://images.example/cup.jpg'))
    expect(fetcher.mock.calls[1][0]).toContain('catalogue=1')
    expect(fetcher.mock.calls.every(([, options]) => !options.method || options.method === 'GET')).toBe(true)
  })
  it('offers retry for temporary errors and shows ambiguous matches without choosing a wrong product', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({ error: '연결 실패' }, 502)).mockResolvedValueOnce(response({ ...base, source: 'none', imageUrls: [], ambiguous: true })))
    render(<PurchasingProductImageButton productName="유리컵" purchaseItemId="purchase-id" />)
    fireEvent.click(screen.getByRole('button', { name: '유리컵' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('연결 실패')
    fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
    expect(await screen.findByText('같은 이름의 상품이 여러 개여서 이미지를 자동 연결하지 않았습니다.')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
