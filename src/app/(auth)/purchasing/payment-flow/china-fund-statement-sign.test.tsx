import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChinaFundStatementPanel } from './china-fund-statement-panel'

describe('China fund statement company-side signs', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows the existing China-side values with opposite signs without changing the records', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      entries: [
        { id: '1', occurredOn: '2026-11-01', direction: 'china_advance', signedAmountCny: 100, balanceAfterCny: 100, sourceLabel: null, memo: null },
        { id: '2', occurredOn: '2026-11-02', direction: 'our_remittance', signedAmountCny: -60, balanceAfterCny: 40, sourceLabel: null, memo: null },
      ], total: 2, page: 1, pageSize: 100, totalPages: 1, hasMore: false,
      currentBalanceCny: 40, currentBalanceAsOf: '2026-11-02', periodAdvanceCny: 100, periodRemittanceCny: 60,
    }) })
    vi.stubGlobal('fetch', fetcher)
    render(<ChinaFundStatementPanel purchaseDeductionCny={30} />)
    fireEvent.click(screen.getByRole('button', { name: '기간 조회' }))
    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row')
    expect(within(rows[1]).getAllByText('-100 元')).toHaveLength(2)
    expect(within(rows[2]).getByText('+60 元')).toBeTruthy()
    expect(screen.getByText('미지급 40 元')).toBeTruthy()
    expect(screen.getByText('미지급 70 元')).toBeTruthy()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][1].method).toBeUndefined()
  })

  it('stores a company-side deposit in the existing China-side format', async () => {
    const statement = { entries: [], total: 0, page: 1, pageSize: 100, totalPages: 1, hasMore: false, currentBalanceCny: 40, currentBalanceAsOf: '2026-11-02', periodAdvanceCny: 100, periodRemittanceCny: 60 }
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => ({ ok: true, json: async () => options.method === 'POST' ? { insertedCount: 1, duplicateCount: 0 } : statement }))
    vi.stubGlobal('fetch', fetcher)
    render(<ChinaFundStatementPanel purchaseDeductionCny={30} />)
    fireEvent.click(screen.getByRole('button', { name: '입금내역 입력' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalled())
    const dialog = screen.getByRole('dialog')
    const row = within(dialog).getAllByRole('row')[1]
    const inputs = within(row).getAllByRole('spinbutton')
    const date = row.querySelector('input[type="date"]') as HTMLInputElement
    fireEvent.change(date, { target: { value: '2026-11-03' } })
    fireEvent.change(inputs[0], { target: { value: '50' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '1건 저장' }))
    await waitFor(() => expect(fetcher.mock.calls.some(([, opts]) => opts.method === 'POST')).toBe(true))
    const post = fetcher.mock.calls.find(([, opts]) => opts.method === 'POST')!
    expect(JSON.parse(String(post[1].body)).entries[0]).toMatchObject({ signedAmountCny: -50, balanceAfterCny: -10 })
  })
})

