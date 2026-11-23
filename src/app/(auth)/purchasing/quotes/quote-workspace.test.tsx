import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const excel = vi.hoisted(() => ({
  loaded: vi.fn(),
  bookNew: vi.fn(() => ({ SheetNames: [], Sheets: {} })),
  appendSheet: vi.fn(),
  jsonToSheet: vi.fn((rows: unknown[]) => rows),
  writeFile: vi.fn(),
}))

vi.mock('xlsx', () => {
  excel.loaded()
  return {
    utils: { book_new: excel.bookNew, book_append_sheet: excel.appendSheet, json_to_sheet: excel.jsonToSheet },
    writeFile: excel.writeFile,
  }
})

import QuoteWorkspace from './quote-workspace'

describe('QuoteWorkspace Excel loading', () => {
  beforeEach(() => {
    window.localStorage.clear()
    excel.writeFile.mockReset()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sales: [{
          id: 'sale-one', clientName: '공용 거래처', quoteDate: new Date().toISOString().slice(0, 10),
          items: [{ id: 'item-one', productCode: 'SKU-1', name: '기존 상품', qty: 2, price: 1000, cost: 600 }],
        }],
        quotes: [], catalog: [],
      }),
    }))
  })

  afterEach(() => vi.unstubAllGlobals())

  it('opens the sales list without loading Excel, then exports its existing rows on demand', async () => {
    render(<QuoteWorkspace />)
    await screen.findByText('공용 거래처')
    expect(excel.loaded).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '전체', exact: true }))

    await waitFor(() => expect(excel.writeFile).toHaveBeenCalledOnce())
    expect(excel.loaded).toHaveBeenCalledOnce()
    expect(excel.jsonToSheet).toHaveBeenCalledWith([
      expect.objectContaining({ 거래처: '공용 거래처', 품목코드: 'SKU-1', 품목명: '기존 상품', 수량: 2, 단가: 1000 }),
    ])
    expect(excel.appendSheet).toHaveBeenCalledWith(expect.any(Object), expect.any(Array), '영업관리')
    expect(excel.writeFile).toHaveBeenCalledWith(expect.any(Object), expect.stringMatching(/^전체영업목록_\d{8}\.xlsx$/))
    expect(screen.getByRole('button', { name: '전체', exact: true })).toBeEnabled()
  })

  it('shows export failures and restores controls for retry', async () => {
    excel.writeFile.mockImplementationOnce(() => { throw new Error('다운로드 저장 실패') })
    render(<QuoteWorkspace />)
    await screen.findByText('공용 거래처')
    fireEvent.click(screen.getByRole('button', { name: '전체', exact: true }))
    await screen.findByText('다운로드 저장 실패')
    expect(screen.getByRole('button', { name: '전체', exact: true })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '전체', exact: true }))
    await waitFor(() => expect(excel.writeFile).toHaveBeenCalledTimes(2))
  })
})
