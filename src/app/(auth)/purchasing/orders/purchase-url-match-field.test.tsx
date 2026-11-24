import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PurchaseUrlMatchField } from './purchase-url-match-field'

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error, warning: mocks.warning } }))

const oldUrl = 'https://detail.1688.com/offer/111111111111.html'
const newUrl = 'https://detail.1688.com/offer/222222222222.html'
const orderNumber = '1234567890123'
const props = { id: 'purchase-1', orderNumber, productName: '수납함', rawData: { purchaseUrlLookup: {
  orderNumber, resolvedUrl: null as string | null,
  links: [{ url: oldUrl, title: '收纳盒', optionName: '白色' }, { url: newUrl, title: '其他商品', optionName: '黑色' }],
} } }
const response = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response

beforeEach(() => vi.clearAllMocks())
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('purchase order product URL matching field', () => {
  it('keeps a saved choice confirmed when downstream master synchronization needs retry', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ url: newUrl, syncWarning: '상품 링크는 저장했습니다.' }))
    render(<PurchaseUrlMatchField {...props} />)
    fireEvent.change(screen.getByRole('combobox', { name: '상품 링크 선택 · 수납함' }), { target: { value: newUrl } })
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
    expect(mocks.warning).toHaveBeenCalledWith('상품 링크는 저장했습니다.')
    expect(screen.getByText('상품 링크 연결됨')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('hides missing, foreign-order or invalid lookup candidates', () => {
    const { container, rerender } = render(<PurchaseUrlMatchField {...props} rawData={{}} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<PurchaseUrlMatchField {...props} rawData={{ purchaseUrlLookup: { ...props.rawData.purchaseUrlLookup, orderNumber: '9999999999999' } }} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<PurchaseUrlMatchField {...props} rawData={{ purchaseUrlLookup: { orderNumber, links: [{ url: 'javascript:alert(1)' }, { url: 'https://other.example/offer/111111111111.html' }] } }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows order product names and options, then saves an explicit choice with concurrency evidence', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ url: newUrl }))
    render(<PurchaseUrlMatchField {...props} />)
    expect(screen.getByText('상품 링크 확인 필요')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '收纳盒 · 白色 · 111111111111' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: '상품 링크 선택 · 수납함' }), { target: { value: newUrl } })
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
    expect(fetcher).toHaveBeenCalledWith('/api/purchasing/purchase-requests/purchase-1/purchase-url', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderNumber, url: newUrl, expectedUrl: null }),
    })
    expect(screen.getByText('상품 링크 연결됨')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '선택한 상품 링크 열기 · 수납함' })).toHaveAttribute('href', newUrl)
  })

  it('keeps a failed choice visible, exposes the server message and retries against the last saved URL', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ error: '저장 후 주문번호가 변경됐습니다.' }, false))
      .mockResolvedValueOnce(response({ url: newUrl }))
    render(<PurchaseUrlMatchField {...props} rawData={{ purchaseUrlLookup: { ...props.rawData.purchaseUrlLookup, resolvedUrl: oldUrl } }} />)
    const select = screen.getByRole('combobox', { name: '상품 링크 선택 · 수납함' })
    fireEvent.change(select, { target: { value: newUrl } })
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('저장 후 주문번호가 변경됐습니다.'))
    expect(select).toHaveValue(newUrl)
    expect(mocks.refresh).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '다시 저장' }))
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
    expect(fetcher.mock.calls.map(([, options]) => JSON.parse(String(options?.body)).expectedUrl)).toEqual([oldUrl, oldUrl])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('disables repeated edits while a save is pending', async () => {
    let finish!: (value: Response) => void
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(resolve => { finish = resolve }))
    render(<PurchaseUrlMatchField {...props} />)
    const select = screen.getByRole('combobox', { name: '상품 링크 선택 · 수납함' })
    fireEvent.change(select, { target: { value: oldUrl } })
    expect(select).toBeDisabled()
    expect(screen.getByText('연결 중')).toBeInTheDocument()
    await act(async () => finish(response({ url: oldUrl })))
    expect(select).not.toBeDisabled()
  })

  it('lets the user return to the saved link after a failed edit without another write', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ error: '네트워크 오류' }, false))
    render(<PurchaseUrlMatchField {...props} rawData={{ purchaseUrlLookup: { ...props.rawData.purchaseUrlLookup, resolvedUrl: oldUrl } }} />)
    const select = screen.getByRole('combobox', { name: '상품 링크 선택 · 수납함' })
    fireEvent.change(select, { target: { value: newUrl } })
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    fireEvent.change(select, { target: { value: oldUrl } })
    expect(select).toHaveValue(oldUrl)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('groups duplicate offer options while keeping their option labels available', () => {
    render(<PurchaseUrlMatchField {...props} rawData={{ purchaseUrlLookup: { orderNumber, links: [
      { url: `${oldUrl}?spm=a`, title: '收纳盒', optionName: '白色' }, { url: oldUrl, title: '收纳盒', optionName: '黑色' },
    ] } }} />)
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(screen.getByRole('option', { name: '收纳盒 · 白色 / 收纳盒 · 黑色 · 111111111111' })).toBeInTheDocument()
  })
})
