import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PurchaseRowDetails } from './purchase-row-details'

describe('compact purchasing row details', () => {
  it('keeps additional controls accessible in a labelled dialog without triggering mutations on open', async () => {
    const save = vi.fn()
    render(<PurchaseRowDetails productName="테스트 상품" sku="SKU-01" attention>
      <div><h3>구입관리코드</h3><span>20261113-1</span></div>
      <button type="button" onClick={save}>결제 정보 저장</button>
    </PurchaseRowDetails>)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '발주 상세 보기' }))
    const dialog = await screen.findByRole('dialog', { name: '발주 상세' })
    expect(within(dialog).getByText('SKU-01 · 테스트 상품')).toHaveAttribute('data-no-translate')
    expect(within(dialog).getByText('20261113-1')).toBeVisible()
    expect(save).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: '결제 정보 저장' }))
    expect(save).toHaveBeenCalledOnce()
    fireEvent.click(within(dialog).getAllByRole('button', { name: '닫기' })[0])
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
